import supabase from '../config/supabase.js';
import { verifyPatientRecordAccess, resolveTargetPatientIdentifiers } from '../services/recordAuthorization.js';

let testPatientsData = null;

export const setTestPatientsData = (data) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Security Error: setTestPatientsData cannot be invoked in production.');
  }
  testPatientsData = data;
};

/**
 * Helper to unpack and filter laboratory reports securely to target patient.
 * Performs strict exact equality verification to prevent accidental cross-patient matches.
 */
function unpackLabReports(rawReports, patientId, specificData, fallbackPatientName) {
  if (!rawReports || !Array.isArray(rawReports)) return [];
  const targetIds = new Set();
  if (patientId) targetIds.add(String(patientId).trim().toLowerCase());
  if (specificData?.roll_number) targetIds.add(String(specificData.roll_number).trim().toLowerCase());
  if (specificData?.employee_id) targetIds.add(String(specificData.employee_id).trim().toLowerCase());
  if (specificData?.registration_number) targetIds.add(String(specificData.registration_number).trim().toLowerCase());

  const unpacked = rawReports.map((record) => {
    let json = {};
    if (record.result) {
      try {
        json = typeof record.result === 'string' ? JSON.parse(record.result) : record.result;
      } catch (e) {}
    }
    const isFinal = record.validated || json.status === 'Completed' || json.status === 'Validated';
    const resolvedPatId = record.patient_id || json.patientId || json.patient_id || record.patientId || '';
    return {
      ...json,
      id: record.id || json.id || '',
      patientId: resolvedPatId,
      patientName: json.patientName || fallbackPatientName || 'Unknown Patient',
      testName: record.test_name || json.testName || record.testName || 'Unknown Test',
      status: isFinal ? 'Completed' : (json.status || 'Pending'),
      date: record.date || json.date || new Date().toISOString().split('T')[0],
      requestedAt: json.requestedAt || new Date().toISOString(),
      completedAt: json.completedAt || json.validatedAt || record.date || new Date().toISOString(),
      validatedAt: json.validatedAt || json.completedAt || record.date || new Date().toISOString()
    };
  }).filter((r) => {
    // Strict exact equality matching: never allows substring false positives
    const rPat = String(r.patientId || '').trim().toLowerCase();
    return targetIds.has(rPat);
  });

  unpacked.totalCount = rawReports.totalCount !== undefined ? rawReports.totalCount : unpacked.length;
  return unpacked;
}

/**
 * Targeted database query for laboratory reports without full-table scans.
 * Supports complete history retrieval and safe pagination without silently dropping older records.
 * Fails closed on database errors to prevent partial histories from masquerading as complete histories.
 */
async function fetchTargetedLabReports(matchPatientIds, rollNumber, employeeId, options = {}) {
  const filterClauses = [];
  if (matchPatientIds && matchPatientIds.length > 0) {
    filterClauses.push(`patient_id.in.(${matchPatientIds.join(',')})`);
    // Also cover unlinked legacy reports where patient UUID was recorded inside JSON
    for (const pid of matchPatientIds) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid)) {
        filterClauses.push(`result.ilike.%"patientId":"${pid}"%`);
        filterClauses.push(`result.ilike.%"patientId": "${pid}"%`);
        filterClauses.push(`result.ilike.%"patient_id":"${pid}"%`);
        filterClauses.push(`result.ilike.%"patient_id": "${pid}"%`);
      }
    }
  }
  // Exact JSON token matching ensuring no substring false-positives (e.g. roll '725' vs '1725')
  if (rollNumber) {
    filterClauses.push(`result.ilike.%"patientId":"${rollNumber}"%`);
    filterClauses.push(`result.ilike.%"patientId": "${rollNumber}"%`);
    filterClauses.push(`result.ilike.%"patient_id":"${rollNumber}"%`);
    filterClauses.push(`result.ilike.%"patient_id": "${rollNumber}"%`);
  }
  if (employeeId) {
    filterClauses.push(`result.ilike.%"patientId":"${employeeId}"%`);
    filterClauses.push(`result.ilike.%"patientId": "${employeeId}"%`);
    filterClauses.push(`result.ilike.%"patient_id":"${employeeId}"%`);
    filterClauses.push(`result.ilike.%"patient_id": "${employeeId}"%`);
  }

  let query = supabase
    .from('lab_reports')
    .select('id, patient_id, test_name, result, validated, date, createdAt', { count: 'exact' });

  if (filterClauses.length > 0 && typeof query.or === 'function') {
    query = query.or(filterClauses.join(','));
  } else if (matchPatientIds && matchPatientIds.length > 0 && typeof query.in === 'function') {
    query = query.in('patient_id', matchPatientIds);
  }

  // Stable deterministic chronological ordering with unique primary-key tie-breaker
  if (typeof query.order === 'function') {
    query = query.order('date', { ascending: false });
    if (typeof query.order === 'function') {
      query = query.order('id', { ascending: false });
    }
  }

  // Safe pagination: applied only when explicitly requested; otherwise complete history is fetched
  if (options.limit && typeof query.range === 'function') {
    const offset = options.offset || 0;
    query = query.range(offset, offset + options.limit - 1);
  } else if (options.limit && typeof query.limit === 'function') {
    query = query.limit(options.limit);
  }

  const { data, count, error } = await query;
  if (error) {
    // Fail closed: do not return an empty array that hides medical records
    throw new Error(`Database error retrieving laboratory reports: ${error.message}`);
  }

  let allData = Array.isArray(data) ? [...data] : [];
  const totalCount = count !== undefined && count !== null ? count : allData.length;

  // Reliable complete-history retrieval: if unpaginated and server PostgREST capped at max-rows (data.length < count)
  if (!options.limit && totalCount > allData.length && typeof supabase.from === 'function') {
    let currentOffset = allData.length;
    const CHUNK_SIZE = 1000;
    while (allData.length < totalCount && currentOffset < 10000) {
      let chunkQuery = supabase
        .from('lab_reports')
        .select('id, patient_id, test_name, result, validated, date, createdAt');
      if (filterClauses.length > 0 && typeof chunkQuery.or === 'function') {
        chunkQuery = chunkQuery.or(filterClauses.join(','));
      } else if (matchPatientIds && matchPatientIds.length > 0 && typeof chunkQuery.in === 'function') {
        chunkQuery = chunkQuery.in('patient_id', matchPatientIds);
      }
      if (typeof chunkQuery.order === 'function') {
        chunkQuery = chunkQuery.order('date', { ascending: false }).order('id', { ascending: false });
      }
      if (typeof chunkQuery.range === 'function') {
        chunkQuery = chunkQuery.range(currentOffset, currentOffset + CHUNK_SIZE - 1);
      } else {
        break;
      }
      const chunkRes = await chunkQuery;
      if (chunkRes.error || !chunkRes.data || chunkRes.data.length === 0) break;
      allData.push(...chunkRes.data);
      currentOffset += chunkRes.data.length;
    }
  }

  allData.totalCount = totalCount;
  return allData;
}

// @desc    Get all patients
// @route   GET /api/patients
export const getPatients = async (req, res) => {
  if (process.env.NODE_ENV !== 'production' && testPatientsData) {
    return res.status(200).json(Object.values(testPatientsData));
  }

  try {
    const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 200) : 100;
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let query = supabase
      .from('profiles')
      .select('id, name, email, created_at, role, patients(roll_number, registration_number, phone, guardian_phone, blood_group), teachers(employee_id, phone, department, designation)')
      .in('role', ['student', 'teacher', 'officer', 'patient']);

    if (typeof query.order === 'function') {
      query = query.order('created_at', { ascending: false });
      if (typeof query.order === 'function') {
        query = query.order('id', { ascending: false });
      }
    }
    if (typeof query.range === 'function') {
      query = query.range(offset, offset + limit - 1);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.status(200).json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Search patients by roll_number, employee_id, UUID, name, or email (returns minimum necessary demographics)
// @route   GET /api/patients/search?query=...
export const searchPatients = async (req, res) => {
  try {
    const callerRole = req.user?.appRole || req.user?.user_metadata?.role || 'student';
    const ALLOWED_STAFF_ROLES = ['doctor', 'admin', 'receptionist', 'staff', 'pharmacist', 'pathologist'];

    if (!ALLOWED_STAFF_ROLES.includes(callerRole)) {
      return res.status(403).json({
        error: `Forbidden: Role '${callerRole}' is not authorized to search patient directories`
      });
    }

    const query = req.query.query ? String(req.query.query).trim() : '';
    if (!query) {
      return res.status(400).json({ error: 'Search query parameter is required' });
    }

    // Fast-path test data for unit/regression tests (non-production only)
    if (process.env.NODE_ENV !== 'production' && testPatientsData) {
      let matchedPatient = null;
      let matchedKey = null;

      const qLower = query.toLowerCase();
      for (const [k, p] of Object.entries(testPatientsData)) {
        if (
          k.toLowerCase() === qLower ||
          p.id?.toLowerCase() === qLower ||
          p.roll_number?.toLowerCase() === qLower ||
          p.employee_id?.toLowerCase() === qLower ||
          p.name?.toLowerCase().includes(qLower) ||
          p.email?.toLowerCase() === qLower
        ) {
          matchedPatient = p;
          matchedKey = k;
          break;
        }
      }

      if (!matchedPatient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      const patientId = matchedPatient.id || matchedKey;

      // Check clinical relationship
      let hasClinicalRelationship = false;
      if (callerRole === 'admin') {
        hasClinicalRelationship = true;
      } else if (callerRole === 'doctor' && req.user) {
        const accessAuth = await verifyPatientRecordAccess(req.user, patientId);
        hasClinicalRelationship = accessAuth.allowed;
      }

      const demographicData = {
        id: matchedPatient.id || patientId,
        name: matchedPatient.name || 'Unknown',
        email: matchedPatient.email || null,
        role: matchedPatient.role || 'patient',
        roll_number: matchedPatient.roll_number || null,
        employee_id: matchedPatient.employee_id || null,
        department: matchedPatient.department || null,
        designation: matchedPatient.designation || null,
        phone: matchedPatient.phone || 'N/A',
        age: matchedPatient.age || 'N/A',
        blood_group: matchedPatient.blood_group || 'N/A',
        guardian_name: matchedPatient.guardian_name || 'N/A',
        guardian_phone: matchedPatient.guardian_phone || 'N/A',
        hasClinicalRelationship,
        treatmentHistory: hasClinicalRelationship ? (matchedPatient.treatmentHistory || []) : [],
        labReports: hasClinicalRelationship ? (matchedPatient.labReports || []) : [],
        visitSummary: hasClinicalRelationship
          ? (matchedPatient.visitSummary || { totalVisits: (matchedPatient.treatmentHistory?.length || 0), lastVisit: null })
          : { totalVisits: 0, lastVisit: null }
      };

      return res.status(200).json(demographicData);
    }

    // Database lookup
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);
    let patientId = null;
    let matchedProfile = null;
    let specificData = null;

    if (isUUID) {
      patientId = query;
      const [profRes, pRes, tRes] = await Promise.all([
        supabase.from('profiles').select('id, name, email, role').eq('id', patientId).maybeSingle(),
        supabase.from('patients').select('id, roll_number, registration_number, department, phone, date_of_birth, blood_group, guardian_name, guardian_phone, age').eq('id', patientId).maybeSingle(),
        supabase.from('teachers').select('id, employee_id, name, department, designation, phone, email').eq('id', patientId).maybeSingle()
      ]);
      matchedProfile = profRes?.data;
      specificData = pRes?.data || tRes?.data;
    } else {
      // Concurrently query patients table by roll/reg and teachers table by employee_id
      const [patientLookup, teacherLookup] = await Promise.all([
        supabase
          .from('patients')
          .select('id, roll_number, registration_number, department, phone, date_of_birth, blood_group, guardian_name, guardian_phone, age')
          .or(`roll_number.eq.${query},registration_number.eq.${query}`)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('teachers')
          .select('id, employee_id, name, department, designation, phone, email')
          .eq('employee_id', query)
          .limit(1)
          .maybeSingle()
      ]);

      if (patientLookup?.data) {
        patientId = patientLookup.data.id;
        specificData = patientLookup.data;
      } else if (teacherLookup?.data) {
        patientId = teacherLookup.data.id;
        specificData = teacherLookup.data;
      } else {
        // Fallback: search profiles table by email or name (ilike)
        const { data: prof } = await supabase
          .from('profiles')
          .select('id, name, email, role')
          .or(`email.eq.${query},name.ilike.%${query}%`)
          .in('role', ['student', 'teacher', 'officer', 'patient'])
          .limit(1)
          .maybeSingle();

        if (prof) {
          patientId = prof.id;
          matchedProfile = prof;
        }
      }
    }

    if (!patientId) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Concurrently fetch profile and specific data if either is missing
    const missingFetches = [];
    if (!matchedProfile) {
      missingFetches.push(
        supabase.from('profiles').select('id, name, email, role').eq('id', patientId).maybeSingle().then(r => { matchedProfile = r?.data; })
      );
    }
    if (!specificData) {
      missingFetches.push(
        supabase.from('patients').select('id, roll_number, registration_number, department, phone, date_of_birth, blood_group, guardian_name, guardian_phone, age').eq('id', patientId).maybeSingle().then(async (r) => {
          if (r?.data) {
            specificData = r.data;
          } else {
            const { data: tData } = await supabase.from('teachers').select('id, employee_id, name, department, designation, phone, email').eq('id', patientId).maybeSingle();
            if (tData) specificData = tData;
          }
        })
      );
    }

    if (missingFetches.length > 0) {
      await Promise.all(missingFetches);
    }

    if (!matchedProfile && !specificData) {
      return res.status(404).json({ error: 'Patient profile not found in database' });
    }

    // Calculate age if date_of_birth exists
    let calculatedAge = "N/A";
    if (specificData?.date_of_birth) {
      const dob = new Date(specificData.date_of_birth);
      const diffMs = Date.now() - dob.getTime();
      const ageDt = new Date(diffMs);
      calculatedAge = Math.abs(ageDt.getUTCFullYear() - 1970);
    } else if (specificData?.age) {
      calculatedAge = specificData.age;
    }

    // Determine clinical relationship
    let hasClinicalRelationship = false;
    if (callerRole === 'admin') {
      hasClinicalRelationship = true;
    } else if (callerRole === 'doctor' && req.user) {
      const accessAuth = await verifyPatientRecordAccess(req.user, patientId, { preloadedData: specificData });
      hasClinicalRelationship = accessAuth.allowed;
    }

    let treatments = [];
    let labReports = [];
    let payloadClinicalMeta = null;
    let clinicalTotalVisits = 0;

    // Only fetch clinical records if relationship exists (preserves walk-in consultation boundary)
    if (hasClinicalRelationship) {
      const matchPatientIds = [patientId];
      if (specificData?.roll_number) matchPatientIds.push(String(specificData.roll_number));
      if (specificData?.employee_id) matchPatientIds.push(String(specificData.employee_id));

      // Fetch complete authorized treatments and targeted lab reports concurrently with deterministic ordering
      let prescQuery = supabase
        .from('prescriptions')
        .select('id, date, diagnosis, doctorName', { count: 'exact' })
        .in('patientId', matchPatientIds)
        .order('date', { ascending: false });
      if (typeof prescQuery.order === 'function') {
        prescQuery = prescQuery.order('id', { ascending: false });
      }

      const [treatmentsRes, rawLabData] = await Promise.all([
        prescQuery,
        fetchTargetedLabReports(matchPatientIds, specificData?.roll_number, specificData?.employee_id)
      ]);

      if (treatmentsRes?.error) {
        throw new Error(`Database error fetching treatments: ${treatmentsRes.error.message}`);
      }

      treatments = treatmentsRes?.data || [];
      const totalPrescriptionCount = treatmentsRes?.count !== undefined && treatmentsRes?.count !== null
        ? treatmentsRes.count
        : treatments.length;

      labReports = unpackLabReports(rawLabData, patientId, specificData, matchedProfile?.name || specificData?.name);
      const totalLabCount = labReports.totalCount !== undefined ? labReports.totalCount : labReports.length;
      const isComplete = (treatments.length >= totalPrescriptionCount) && (labReports.length >= totalLabCount);

      payloadClinicalMeta = {
        isComplete,
        totalPrescriptions: totalPrescriptionCount,
        retrievedPrescriptions: treatments.length,
        totalLabReports: totalLabCount,
        retrievedLabReports: labReports.length
      };
      clinicalTotalVisits = totalPrescriptionCount;
    }

    const payload = {
      id: matchedProfile?.id || patientId,
      name: matchedProfile?.name || specificData?.name || 'Unknown',
      email: matchedProfile?.email || null,
      role: matchedProfile?.role || 'patient',
      roll_number: specificData?.roll_number || null,
      employee_id: specificData?.employee_id || null,
      department: specificData?.department || null,
      designation: specificData?.designation || null,
      phone: specificData?.phone || 'N/A',
      age: calculatedAge,
      blood_group: specificData?.blood_group || 'N/A',
      guardian_name: specificData?.guardian_name || 'N/A',
      guardian_phone: specificData?.guardian_phone || 'N/A',
      hasClinicalRelationship,
      treatmentHistory: treatments,
      labReports,
      visitSummary: {
        totalVisits: clinicalTotalVisits,
        lastVisit: treatments[0]?.date || null
      },
      ...(payloadClinicalMeta ? { clinicalHistoryMeta: payloadClinicalMeta } : {})
    };

    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// @desc    Get comprehensive patient profile by ID or roll_number
// @route   GET /api/patients/:id
export const getPatientById = async (req, res) => {
  try {
    const { id } = req.params;
    let patientId = id ? id.trim() : '';

    // Fast-path test data for unit/regression tests (non-production only)
    if (process.env.NODE_ENV !== 'production' && testPatientsData) {
      let resolvedId = patientId;
      if (testPatientsData[patientId]) {
        resolvedId = patientId;
      } else {
        for (const [k, p] of Object.entries(testPatientsData)) {
          if (p.roll_number === patientId || p.employee_id === patientId || k === patientId) {
            resolvedId = k;
            break;
          }
        }
      }

      // Verify patient record authorization (enforce patient ownership or doctor clinical relationship)
      if (req.user) {
        const accessAuth = await verifyPatientRecordAccess(req.user, resolvedId);
        if (!accessAuth.allowed) {
          return res.status(403).json({
            error: accessAuth.reason || 'Forbidden: Access to this patient record is denied'
          });
        }
      }

      if (testPatientsData[resolvedId]) {
        return res.status(200).json(testPatientsData[resolvedId]);
      }
      return res.status(404).json({ error: 'Patient not found' });
    }

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId);

    let specificData = null;

    // Resolve non-UUID roll numbers or employee IDs concurrently
    if (!isUUID) {
      const [patientLookup, teacherLookup] = await Promise.all([
        supabase
          .from('patients')
          .select('id, roll_number, registration_number, department, phone, date_of_birth, blood_group, guardian_name, guardian_phone, age')
          .eq('roll_number', patientId)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('teachers')
          .select('id, employee_id, name, department, designation, phone, email')
          .eq('employee_id', patientId)
          .limit(1)
          .maybeSingle()
      ]);

      if (patientLookup?.data) {
        patientId = patientLookup.data.id;
        specificData = patientLookup.data;
      } else if (teacherLookup?.data) {
        patientId = teacherLookup.data.id;
        specificData = teacherLookup.data;
      } else {
        return res.status(404).json({ error: 'Patient not found' });
      }
    }

    // Verify patient record authorization ONCE using resolved canonical identity
    if (req.user) {
      const accessAuth = await verifyPatientRecordAccess(req.user, patientId, { preloadedData: specificData });
      if (!accessAuth.allowed) {
        return res.status(403).json({
          error: accessAuth.reason || 'Forbidden: Access to this patient record is denied'
        });
      }
    }

    // Support safe pagination if requested, but default to complete authorized clinical history
    const historyLimit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 500) : null;
    const historyOffset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const matchPatientIds = [patientId];
    if (specificData?.roll_number) matchPatientIds.push(String(specificData.roll_number));
    if (specificData?.employee_id) matchPatientIds.push(String(specificData.employee_id));

    let prescQuery = supabase
      .from('prescriptions')
      .select('id, date, diagnosis, doctorName', { count: 'exact' })
      .in('patientId', matchPatientIds)
      .order('date', { ascending: false });

    if (typeof prescQuery.order === 'function') {
      prescQuery = prescQuery.order('id', { ascending: false });
    }

    if (historyLimit && typeof prescQuery.range === 'function') {
      prescQuery = prescQuery.range(historyOffset, historyOffset + historyLimit - 1);
    } else if (historyLimit && typeof prescQuery.limit === 'function') {
      prescQuery = prescQuery.limit(historyLimit);
    }

    const labOptions = historyLimit ? { limit: historyLimit, offset: historyOffset } : {};

    // Execute independent data queries CONCURRENTLY with Promise.all
    const queries = [
      supabase.from('profiles').select('id, name, email, role, created_at').eq('id', patientId).maybeSingle(),
      specificData
        ? Promise.resolve({ data: specificData, error: null })
        : supabase.from('patients').select('id, roll_number, registration_number, department, phone, date_of_birth, blood_group, guardian_name, guardian_phone, age').eq('id', patientId).maybeSingle().then(async (r) => {
            if (r?.data) return r;
            return supabase.from('teachers').select('id, employee_id, name, department, designation, phone, email').eq('id', patientId).maybeSingle();
          }),
      prescQuery,
      fetchTargetedLabReports(matchPatientIds, specificData?.roll_number, specificData?.employee_id, labOptions)
    ];

    const [profileRes, specificRes, treatmentsRes, rawLabData] = await Promise.all(queries);

    if (treatmentsRes?.error) {
      throw new Error(`Database error retrieving treatments: ${treatmentsRes.error.message}`);
    }

    const profile = profileRes?.data;
    if (specificRes?.data) {
      specificData = specificRes.data;
      if (specificData.roll_number && !matchPatientIds.includes(String(specificData.roll_number))) {
        matchPatientIds.push(String(specificData.roll_number));
      }
      if (specificData.employee_id && !matchPatientIds.includes(String(specificData.employee_id))) {
        matchPatientIds.push(String(specificData.employee_id));
      }
    }

    if (!profile && !specificData) {
      return res.status(404).json({ error: 'Patient profile not found in database' });
    }

    const patientName = profile?.name || specificData?.name || 'Unknown';
    const patientEmail = profile?.email || null;
    let treatments = Array.isArray(treatmentsRes?.data) ? [...treatmentsRes.data] : [];
    const totalPrescriptionCount = treatmentsRes?.count !== undefined && treatmentsRes?.count !== null
      ? treatmentsRes.count
      : treatments.length;

    // Reliable complete-history retrieval: if unpaginated and server PostgREST capped at max-rows
    if (!historyLimit && totalPrescriptionCount > treatments.length && typeof supabase.from === 'function') {
      let currentOffset = treatments.length;
      const CHUNK_SIZE = 1000;
      while (treatments.length < totalPrescriptionCount && currentOffset < 10000) {
        let chunkQuery = supabase
          .from('prescriptions')
          .select('id, date, diagnosis, doctorName')
          .in('patientId', matchPatientIds);
        if (typeof chunkQuery.order === 'function') {
          chunkQuery = chunkQuery.order('date', { ascending: false }).order('id', { ascending: false });
        }
        if (typeof chunkQuery.range === 'function') {
          chunkQuery = chunkQuery.range(currentOffset, currentOffset + CHUNK_SIZE - 1);
        } else {
          break;
        }
        const chunkRes = await chunkQuery;
        if (chunkRes.error || !chunkRes.data || chunkRes.data.length === 0) break;
        treatments.push(...chunkRes.data);
        currentOffset += chunkRes.data.length;
      }
    }

    const labReports = unpackLabReports(rawLabData, patientId, specificData, patientName);
    const totalLabCount = labReports.totalCount !== undefined ? labReports.totalCount : labReports.length;
    const isComplete = (treatments.length >= totalPrescriptionCount) && (labReports.length >= totalLabCount);

    // Calculate age from date_of_birth
    let calculatedAge = "N/A";
    if (specificData?.date_of_birth) {
      const dob = new Date(specificData.date_of_birth);
      const diffMs = Date.now() - dob.getTime();
      const ageDt = new Date(diffMs);
      calculatedAge = Math.abs(ageDt.getUTCFullYear() - 1970);
    } else if (specificData?.age) {
      calculatedAge = specificData.age;
    }

    // Combine everything into one JSON object matching the exact frontend contract
    const comprehensiveData = {
      id: profile ? profile.id : patientId,
      email: patientEmail,
      name: patientName,
      ...specificData,
      name: patientName,
      age: calculatedAge,
      treatmentHistory: treatments,
      labReports: labReports,
      visitSummary: {
        totalVisits: totalPrescriptionCount,
        lastVisit: treatments[0]?.date || null
      },
      clinicalHistoryMeta: {
        isComplete,
        totalPrescriptions: totalPrescriptionCount,
        retrievedPrescriptions: treatments.length,
        totalLabReports: totalLabCount,
        retrievedLabReports: labReports.length,
        isPaginated: Boolean(historyLimit)
      }
    };

    res.status(200).json(comprehensiveData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Register a new patient with full details
// @route   POST /api/patients
export const createPatient = async (req, res) => {
  try {
    const {
      email, password, name,
      roll_number, registration_number,
      phone, date_of_birth, blood_group, guardian_name, guardian_phone, department
    } = req.body;

    // 1. Create the user in Supabase Auth (This automatically triggers profiles creation)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: 'patient' }
    });

    if (authError) throw authError;

    const newUserId = authData.user.id;

    // 2. Insert the extra medical data into the patients table
    const { data: patientData, error: patientError } = await supabase
      .from('patients')
      .insert([
        {
          id: newUserId,
          roll_number,
          registration_number,
          phone,
          date_of_birth,
          blood_group,
          guardian_name,
          guardian_phone,
          department
        }
      ])
      .select();

    if (patientError) {
      throw patientError;
    }

    res.status(201).json({
      message: 'Patient registered successfully',
      user: authData.user,
      patientDetails: patientData[0]
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Update a patient's medical details
// @route   PUT /api/patients/:id
export const updatePatient = async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = req.body;

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let patientId = id;

    if (!isUUID) {
      const [patientLookup, teacherLookup] = await Promise.all([
        supabase.from('patients').select('id').eq('roll_number', patientId).limit(1).maybeSingle(),
        supabase.from('teachers').select('id').eq('employee_id', patientId).limit(1).maybeSingle()
      ]);

      const patientRecord = patientLookup?.data || teacherLookup?.data;
      if (!patientRecord) {
        return res.status(404).json({ error: 'Patient not found' });
      }
      patientId = patientRecord.id;
    }

    const { data, error } = await supabase
      .from('patients')
      .update(updateFields)
      .eq('id', patientId)
      .select();

    if (error) throw error;

    res.status(200).json({
      message: 'Patient updated successfully',
      patientDetails: data[0]
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
