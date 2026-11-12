import supabase from '../config/supabase.js';

let testRelationships = null;
let testIdentifiersMap = null;

export const setTestRelationships = (rel) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Security Error: setTestRelationships cannot be invoked in production.');
  }
  testRelationships = rel;
};

export const setTestIdentifiers = (map) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Security Error: setTestIdentifiers cannot be invoked in production.');
  }
  testIdentifiersMap = map;
};

/**
 * Resolves all canonical identifiers (UUID, roll number, registration number, employee ID)
 * belonging to a given authenticated user.
 * Concurrently checks patients and teachers tables for minimal latency.
 */
export async function getUserPatientIdentifiers(user) {
  if (!user || !user.id) {
    return {
      primaryId: null,
      canonicalIds: [],
      normalizedSet: new Set()
    };
  }

  const userId = String(user.id).trim();
  const canonicalIds = [userId];

  if (process.env.NODE_ENV !== 'production' && testIdentifiersMap) {
    if (testIdentifiersMap[userId]) {
      return {
        primaryId: userId,
        canonicalIds: testIdentifiersMap[userId],
        normalizedSet: new Set(testIdentifiersMap[userId].map((id) => id.toLowerCase()))
      };
    }
    return {
      primaryId: userId,
      canonicalIds: [userId],
      normalizedSet: new Set([userId.toLowerCase()])
    };
  }

  try {
    // Concurrently check patients (student) and teachers (faculty) tables
    const [patientRes, teacherRes] = await Promise.all([
      supabase
        .from('patients')
        .select('roll_number, registration_number')
        .eq('id', userId)
        .maybeSingle(),
      supabase
        .from('teachers')
        .select('employee_id')
        .eq('id', userId)
        .maybeSingle()
    ]);

    const patientRecord = patientRes?.data;
    if (patientRecord) {
      if (patientRecord.roll_number) canonicalIds.push(String(patientRecord.roll_number).trim());
      if (patientRecord.registration_number) canonicalIds.push(String(patientRecord.registration_number).trim());
    }

    const teacherRecord = teacherRes?.data;
    if (teacherRecord && teacherRecord.employee_id) {
      canonicalIds.push(String(teacherRecord.employee_id).trim());
    }
  } catch (err) {
    // If DB query fails or in isolated tests, continue with primary user ID
  }

  const normalizedSet = new Set(canonicalIds.map((id) => id.toLowerCase()));

  return {
    primaryId: userId,
    canonicalIds,
    normalizedSet
  };
}

/**
 * Resolves a target patient identifier (which may be a UUID or a roll/employee ID)
 * to its complete set of matching canonical IDs.
 * Accepts optional preloaded identifiers to avoid duplicate database lookups.
 */
export async function resolveTargetPatientIdentifiers(targetId, preloadedData = null) {
  if (!targetId) return { canonicalIds: [], normalizedSet: new Set() };

  const idStr = String(targetId).trim();
  const canonicalIds = [idStr];

  // Fast-path test identifiers map (non-production only)
  if (process.env.NODE_ENV !== 'production' && testIdentifiersMap) {
    if (testIdentifiersMap[idStr]) {
      return {
        canonicalIds: testIdentifiersMap[idStr],
        normalizedSet: new Set(testIdentifiersMap[idStr].map((id) => id.toLowerCase()))
      };
    }
    return {
      canonicalIds: [idStr],
      normalizedSet: new Set([idStr.toLowerCase()])
    };
  }

  // Fast-path if caller already resolved the patient or teacher record
  if (preloadedData) {
    if (preloadedData.id) canonicalIds.push(String(preloadedData.id).trim());
    if (preloadedData.roll_number) canonicalIds.push(String(preloadedData.roll_number).trim());
    if (preloadedData.registration_number) canonicalIds.push(String(preloadedData.registration_number).trim());
    if (preloadedData.employee_id) canonicalIds.push(String(preloadedData.employee_id).trim());
    const uniqueIds = [...new Set(canonicalIds)];
    return {
      canonicalIds: uniqueIds,
      normalizedSet: new Set(uniqueIds.map((id) => id.toLowerCase()))
    };
  }

  try {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);

    if (isUUID) {
      // Concurrently query patients and teachers tables for associated identifiers
      const [pRes, tRes] = await Promise.all([
        supabase.from('patients').select('roll_number, registration_number').eq('id', idStr).maybeSingle(),
        supabase.from('teachers').select('employee_id').eq('id', idStr).maybeSingle()
      ]);

      const p = pRes?.data;
      if (p?.roll_number) canonicalIds.push(String(p.roll_number).trim());
      if (p?.registration_number) canonicalIds.push(String(p.registration_number).trim());

      const t = tRes?.data;
      if (t?.employee_id) canonicalIds.push(String(t.employee_id).trim());
    } else {
      // Identifier is roll number or employee ID; resolve UUID concurrently
      const [pRes, tRes] = await Promise.all([
        supabase.from('patients').select('id, roll_number, registration_number').eq('roll_number', idStr).maybeSingle(),
        supabase.from('teachers').select('id, employee_id').eq('employee_id', idStr).maybeSingle()
      ]);

      const p = pRes?.data;
      if (p?.id) canonicalIds.push(String(p.id).trim());
      if (p?.registration_number) canonicalIds.push(String(p.registration_number).trim());

      const t = tRes?.data;
      if (t?.id) canonicalIds.push(String(t.id).trim());
    }
  } catch (err) {
    // Continue with whatever identifiers were resolved
  }

  const uniqueIds = [...new Set(canonicalIds)];
  const normalizedSet = new Set(uniqueIds.map((id) => id.toLowerCase()));
  return { canonicalIds: uniqueIds, normalizedSet };
}

/**
 * Verifies whether the requesting user is authorized to access the target patient's clinical record.
 *
 * Rules:
 * - Admin: Full authorized access.
 * - Student/Patient/Teacher: Allowed ONLY if the target matches their own canonical identifiers.
 * - Doctor: Allowed ONLY if an active or past clinical relationship exists (appointment, prescription, certificate).
 * - Other staff: Denied full clinical record access.
 */
export async function verifyPatientRecordAccess(user, targetPatientId, options = {}) {
  if (!user || !user.id) {
    return { allowed: false, reason: 'Unauthorized: User authentication required' };
  }

  const role = user.appRole || user.user_metadata?.role || 'student';

  // 1. Administrators have hospital-wide clinical oversight
  if (role === 'admin') {
    return { allowed: true, reason: 'Administrator clinical access' };
  }

  // 2. Resolve target patient identifiers (reuses preloaded data if provided)
  const target = options.targetIdentifiers ||
    await resolveTargetPatientIdentifiers(targetPatientId, options.preloadedData);
  const targetIdLower = String(targetPatientId).trim().toLowerCase();

  // 3. Patient / Student / Teacher Ownership Verification
  if (['student', 'patient', 'teacher'].includes(role)) {
    const userIdentifiers = await getUserPatientIdentifiers(user);
    const isOwner = userIdentifiers.normalizedSet.has(targetIdLower) ||
      target.canonicalIds.some((cid) => userIdentifiers.normalizedSet.has(cid.toLowerCase()));

    if (isOwner) {
      return { allowed: true, reason: 'Authorized patient access to own record' };
    }

    return {
      allowed: false,
      reason: 'Forbidden: You are not authorized to view clinical records belonging to another patient'
    };
  }

  // 4. Doctor Clinical Relationship Verification
  if (role === 'doctor') {
    const doctorId = String(user.id);
    const checkIds = target.canonicalIds.length > 0 ? target.canonicalIds : [targetPatientId];

    // Fast-path test relationships (non-production only)
    if (process.env.NODE_ENV !== 'production' && testRelationships && testRelationships[doctorId]) {
      const allowedPatients = testRelationships[doctorId];
      const hasRel = checkIds.some((cid) => allowedPatients.includes(cid));
      if (hasRel) {
        return { allowed: true, reason: 'Doctor has active consultation appointment with patient' };
      }
      return {
        allowed: false,
        reason: 'Forbidden: No clinical relationship exists between this doctor and the requested patient'
      };
    }

    try {
      // Concurrently check appointments, prescriptions, and certificates
      const [apptRes, prescRes, certRes] = await Promise.all([
        supabase
          .from('appointments')
          .select('id')
          .eq('doctorId', doctorId)
          .in('patientId', checkIds)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('prescriptions')
          .select('id')
          .eq('doctorId', doctorId)
          .in('patientId', checkIds)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('certificates')
          .select('id')
          .eq('doctorId', doctorId)
          .in('patientId', checkIds)
          .limit(1)
          .maybeSingle()
      ]);

      if (apptRes?.data) {
        return { allowed: true, reason: 'Doctor has active consultation appointment with patient' };
      }

      if (prescRes?.data) {
        return { allowed: true, reason: 'Doctor has authored prescriptions for patient' };
      }

      if (certRes?.data) {
        return { allowed: true, reason: 'Doctor has issued medical certificates for patient' };
      }
    } catch (err) {
      // DB error or test mode
    }

    return {
      allowed: false,
      reason: 'Forbidden: No clinical relationship exists between this doctor and the requested patient'
    };
  }

  // Default fail-closed for any other role
  return {
    allowed: false,
    reason: `Forbidden: Role '${role}' is not authorized to inspect clinical patient histories`
  };
}
