import supabase from '../config/supabase.js';
import { verifyPatientRecordAccess } from '../services/recordAuthorization.js';

let testPatientsData = null;

export const setTestPatientsData = (data) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Security Error: setTestPatientsData cannot be invoked in production.');
  }
  testPatientsData = data;
};

// @desc    Get all patients
// @route   GET /api/patients
export const getPatients = async (req, res) => {
  if (process.env.NODE_ENV !== 'production' && testPatientsData) {
    return res.status(200).json(Object.values(testPatientsData));
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, email, created_at, role, patients(roll_number, registration_number, phone, guardian_phone, blood_group), teachers(employee_id, phone, department, designation)')
      .in('role', ['student', 'teacher', 'officer', 'patient']);

    if (error) throw error;

    res.status(200).json(data);
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
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', patientId).maybeSingle();
      matchedProfile = prof;
    } else {
      // 1. Search patients table by roll_number or registration_number
      const { data: pRec } = await supabase
        .from('patients')
        .select('*')
        .or(`roll_number.eq.${query},registration_number.eq.${query}`)
        .limit(1)
        .maybeSingle();

      if (pRec) {
        patientId = pRec.id;
        specificData = pRec;
      } else {
        // 2. Search teachers table by employee_id
        const { data: tRec } = await supabase
          .from('teachers')
          .select('*')
          .eq('employee_id', query)
          .limit(1)
          .maybeSingle();

        if (tRec) {
          patientId = tRec.id;
          specificData = tRec;
        } else {
          // 3. Search profiles table by email or name (ilike)
          const { data: prof } = await supabase
            .from('profiles')
            .select('*')
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
    }

    if (!patientId) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Fetch profile if not already fetched
    if (!matchedProfile) {
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', patientId).maybeSingle();
      matchedProfile = prof;
    }

    // Fetch specific data if not already fetched
    if (!specificData) {
      const { data: pData } = await supabase.from('patients').select('*').eq('id', patientId).maybeSingle();
      specificData = pData;
      if (!specificData) {
        const { data: tData } = await supabase.from('teachers').select('*').eq('id', patientId).maybeSingle();
        specificData = tData;
      }
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
      const accessAuth = await verifyPatientRecordAccess(req.user, patientId);
      hasClinicalRelationship = accessAuth.allowed;
    }

    let treatments = [];
    let labReports = [];

    // Only fetch clinical records if relationship exists
    if (hasClinicalRelationship) {
      const matchPatientIds = [patientId];
      if (specificData?.roll_number) matchPatientIds.push(String(specificData.roll_number));
      if (specificData?.employee_id) matchPatientIds.push(String(specificData.employee_id));

      const { data: trData } = await supabase
        .from('prescriptions')
        .select('id, date, diagnosis, doctorName')
        .in('patientId', matchPatientIds)
        .order('date', { ascending: false });
      treatments = trData || [];

      // Fetch lab reports
      const { data: rawLabReports } = await supabase
        .from('lab_reports')
        .select('*')
        .order('date', { ascending: false });

      if (rawLabReports) {
        const pIdLower = String(patientId).toLowerCase();
        const rollLower = specificData?.roll_number ? String(specificData.roll_number).toLowerCase() : '';
        const empLower = specificData?.employee_id ? String(specificData.employee_id).toLowerCase() : '';

        labReports = rawLabReports.map(record => {
          let json = {};
          if (record.result) {
            try { json = JSON.parse(record.result); } catch (e) {}
          }
          const isFinal = record.validated || json.status === 'Completed' || json.status === 'Validated';
          return {
            ...json,
            id: record.id || json.id || '',
            patientId: record.patient_id || json.patientId || '',
            testName: record.test_name || json.testName || 'Unknown Test',
            status: isFinal ? 'Completed' : (json.status || 'Pending'),
            date: record.date || json.date || new Date().toISOString().split('T')[0]
          };
        }).filter(r => {
          const rPat = String(r.patientId || '').toLowerCase();
          return rPat === pIdLower || (rollLower && rPat === rollLower) || (empLower && rPat === empLower);
        });
      }
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
        totalVisits: treatments.length,
        lastVisit: treatments[0]?.date || null
      }
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

    // Verify patient record authorization before DB queries to prevent enumeration
    if (req.user) {
      const accessAuth = await verifyPatientRecordAccess(req.user, patientId);
      if (!accessAuth.allowed) {
        return res.status(403).json({
          error: accessAuth.reason || 'Forbidden: Access to this patient record is denied'
        });
      }
    }

    // Check if ID is UUID, otherwise treat as roll_number
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId);

    console.log('--- ROUTE HIT ---');
    console.log('Raw ID:', id, 'Length:', id?.length);
    console.log('Is UUID:', isUUID);

          if (!isUUID) {
        console.log('Searching by roll_number or employee_id:', patientId);
        let { data: patientRecord, error: pError } = await supabase
          .from('patients')
          .select('id')
          .eq('roll_number', patientId).limit(1).maybeSingle();

        if (!patientRecord) {
           const { data: teacherRecord } = await supabase
             .from('teachers')
             .select('id')
             .eq('employee_id', patientId).limit(1).maybeSingle();
           if (teacherRecord) {
             patientRecord = teacherRecord;
             pError = null;
           }
        }

        if (pError || !patientRecord) {
          return res.status(404).json({ error: 'Patient not found' });
        }
        patientId = patientRecord.id;
      }

    console.log('Found patient UUID:', patientId);

    // Verify patient record authorization (enforce patient ownership or doctor clinical relationship)
    if (req.user) {
      const accessAuth = await verifyPatientRecordAccess(req.user, patientId);
      if (!accessAuth.allowed) {
        return res.status(403).json({
          error: accessAuth.reason || 'Forbidden: Access to this patient record is denied'
        });
      }
    }

    if (testPatientsData && testPatientsData[patientId]) {
      return res.status(200).json(testPatientsData[patientId]);
    }

    // 1. Fetch Profile Data
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', patientId)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      console.warn('Patient profile not found in profiles table, checking fallbacks');
    }

    // 2. Fetch Patient Specific Data
    const { data: patientData, error: patientError } = await supabase
      .from('patients')
      .select('*')
      .eq('id', patientId)
      .maybeSingle();

    let specificData = patientData;

    // Check teachers table if not found in patients table
    if (!specificData) {
      const { data: teacherData } = await supabase
        .from('teachers')
        .select('*')
        .eq('id', patientId)
        .maybeSingle();
      if (teacherData) {
        specificData = teacherData;
      }
    }

    if (!profile && !specificData) {
      return res.status(404).json({ error: 'Patient profile not found in database' });
    }

    let patientName = profile?.name || specificData?.name || null;
    let patientEmail = profile?.email || null;

    if (!patientName) {
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(patientId);
        if (authUser?.user) {
          patientName = authUser.user.user_metadata?.name || null;
          patientEmail = patientEmail || authUser.user.email;
        }
      } catch (authErr) {
        console.warn('Auth user lookup fallback error:', authErr.message);
      }
    }
    const secretKeyExists = !!process.env.SUPABASE_SECRET_KEY;
    console.log('Query ID:', patientId);
    console.log('Secret Key exists?', secretKeyExists);
    console.log('Patient Data Result:', patientData);
    console.log('-------------------------');

    // 3. Fetch Treatment History (from prescriptions table)
    const matchPatientIds = [patientId];
    if (specificData?.roll_number) matchPatientIds.push(String(specificData.roll_number));
    if (specificData?.employee_id) matchPatientIds.push(String(specificData.employee_id));

    const { data: treatments, error: treatmentsError } = await supabase
      .from('prescriptions')
      .select('id, date, diagnosis, doctorName')
      .in('patientId', matchPatientIds)
      .order('date', { ascending: false });

    // 4. Fetch Lab Reports
    const { data: rawLabReports, error: labError } = await supabase
      .from('lab_reports')
      .select('*')
      .order('date', { ascending: false });

    let labReports = [];
    if (!labError && rawLabReports) {
      const unpacked = rawLabReports.map(record => {
        let json = {};
        if (record.result) {
          try { json = JSON.parse(record.result); } catch (e) {}
        }
        const isFinal = record.validated || json.status === 'Completed' || json.status === 'Validated';
        return {
          ...json,
          id: record.id || json.id || '',
          patientId: record.patient_id || json.patientId || '',
          patientName: json.patientName || patientName || 'Unknown Patient',
          testName: record.test_name || json.testName || 'Unknown Test',
          status: isFinal ? 'Completed' : (json.status || 'Pending'),
          date: record.date || json.date || new Date().toISOString().split('T')[0],
          requestedAt: json.requestedAt || new Date().toISOString(),
          completedAt: json.completedAt || json.validatedAt || record.date || new Date().toISOString(),
          validatedAt: json.validatedAt || json.completedAt || record.date || new Date().toISOString()
        };
      });

      const pIdLower = String(patientId).toLowerCase();
      const rollLower = specificData?.roll_number ? String(specificData.roll_number).toLowerCase() : '';
      const empLower = specificData?.employee_id ? String(specificData.employee_id).toLowerCase() : '';

      labReports = unpacked.filter(r => {
        const rPat = String(r.patientId || '').toLowerCase();
        return rPat === pIdLower || (rollLower && rPat === rollLower) || (empLower && rPat === empLower);
      });
    }

    // Calculate age from date_of_birth
    let calculatedAge = "N/A";
    if (specificData && specificData.date_of_birth) {
      const dob = new Date(specificData.date_of_birth);
      const diffMs = Date.now() - dob.getTime();
      const ageDt = new Date(diffMs);
      calculatedAge = Math.abs(ageDt.getUTCFullYear() - 1970);
    } else if (specificData && specificData.age) {
      calculatedAge = specificData.age; // fallback for older records
    }

    // Combine everything into one big JSON object matching the UI
    const comprehensiveData = {
      id: profile ? profile.id : patientId,
      email: patientEmail,
      name: (patientName || profile?.name || 'Unknown'),
      ...specificData, // adds phone, blood_group, guardian info, etc.
      name: (patientName || specificData?.name || profile?.name || 'Unknown'),
      age: calculatedAge,
      treatmentHistory: treatments || [],
      labReports: labReports || [],
      visitSummary: {
        totalVisits: treatments?.length || 0,
        lastVisit: treatments?.[0]?.date || null
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
    const updateFields = req.body; // e.g. { date_of_birth: "...", registration_number: "..." }

    // First check if ID is UUID or roll_number
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let patientId = id;

          if (!isUUID) {
        console.log('Searching by roll_number or employee_id:', patientId);
        let { data: patientRecord, error: pError } = await supabase
          .from('patients')
          .select('id')
          .eq('roll_number', patientId).limit(1).maybeSingle();

        if (!patientRecord) {
           const { data: teacherRecord } = await supabase
             .from('teachers')
             .select('id')
             .eq('employee_id', patientId).limit(1).maybeSingle();
           if (teacherRecord) {
             patientRecord = teacherRecord;
             pError = null;
           }
        }

        if (pError || !patientRecord) {
          return res.status(404).json({ error: 'Patient not found' });
        }
        patientId = patientRecord.id;
      }

    // Now update the patients table
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
