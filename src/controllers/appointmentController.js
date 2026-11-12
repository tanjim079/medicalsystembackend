import supabase from '../config/supabase.js';
import { resolveTargetPatientIdentifiers, getUserPatientIdentifiers } from '../services/recordAuthorization.js';

const unpackSymptoms = (record) => {
  if (record && record.symptoms && typeof record.symptoms === 'string' && record.symptoms.startsWith('{')) {
    try {
      const parsed = JSON.parse(record.symptoms);
      record.symptoms = parsed.text;
      record.serialNumber = parsed.serialNumber;
    } catch (e) {}
  }
  return record;
};

const enrichAppointmentsWithUniversityId = async (records) => {
  if (!records || records.length === 0) return records;
  const patientIds = [...new Set(records.map((r) => r.patientId).filter(Boolean))];
  if (patientIds.length === 0) return records;

  try {
    // Concurrently fetch roll numbers from patients and employee IDs from teachers
    const [ptRes, tcRes] = await Promise.all([
      supabase.from('patients').select('id, roll_number').in('id', patientIds),
      supabase.from('teachers').select('id, employee_id').in('id', patientIds)
    ]);

    const idMap = {};
    ptRes?.data?.forEach((p) => { if (p.roll_number) idMap[p.id] = p.roll_number; });
    tcRes?.data?.forEach((t) => { if (t.employee_id) idMap[t.id] = t.employee_id; });

    records.forEach((r) => {
      r.patientUniversityId = idMap[r.patientId] || r.patientId;
    });
  } catch (err) {
    console.warn('Could not enrich appointments with university ID:', err.message);
  }
  return records;
};

// @desc    Get appointments with optional filters and safe pagination
// @route   GET /api/appointments
export const getAppointments = async (req, res) => {
  try {
    const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 500) : null;
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { doctorId, patientId, date, status } = req.query;

    let query = supabase
      .from('appointments')
      .select('id, "patientId", "patientName", "doctorId", "doctorName", date, time, type, status, symptoms, "createdAt"');

    if (doctorId && typeof query.eq === 'function') {
      query = query.eq('doctorId', doctorId);
    }
    if (patientId && typeof query.eq === 'function') {
      query = query.eq('patientId', patientId);
    }
    if (date && typeof query.eq === 'function') {
      query = query.eq('date', date);
    }
    if (status && typeof query.eq === 'function') {
      query = query.eq('status', status);
    }

    if (typeof query.order === 'function') {
      query = query.order('createdAt', { ascending: false });
      if (typeof query.order === 'function') {
        query = query.order('id', { ascending: false });
      }
    }
    if (limit && typeof query.range === 'function') {
      query = query.range(offset, offset + limit - 1);
    } else if (limit && typeof query.limit === 'function') {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) throw error;

    const records = (data || []).map(unpackSymptoms);
    await enrichAppointmentsWithUniversityId(records);
    res.status(200).json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Create new appointment
// @route   POST /api/appointments
export const createAppointment = async (req, res) => {
  try {
    const payload = { ...req.body };

    if (!payload.type) {
      payload.type = 'General';
    }

    if (payload.serialNumber) {
      payload.symptoms = JSON.stringify({
        text: payload.symptoms || '',
        serialNumber: payload.serialNumber
      });
      delete payload.serialNumber;
    }

    delete payload.id;
    delete payload.createdAt;

    const { data, error } = await supabase
      .from('appointments')
      .insert([payload])
      .select('id, "patientId", "patientName", "doctorId", "doctorName", date, time, type, status, symptoms, "createdAt"');

    if (error) throw error;

    const records = (data || []).map(unpackSymptoms);
    await enrichAppointmentsWithUniversityId(records);
    res.status(201).json(records[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Update appointment status
// @route   PUT /api/appointments/:id/status
export const updateAppointmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data, error } = await supabase
      .from('appointments')
      .update({ status })
      .eq('id', id)
      .select('id, "patientId", "patientName", "doctorId", "doctorName", date, time, type, status, symptoms, "createdAt"');

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const records = data.map(unpackSymptoms);
    await enrichAppointmentsWithUniversityId(records);
    res.status(200).json(records[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Get appointments for a specific patient
// @route   GET /api/appointments/patient/:patientId
export const getAppointmentsByPatient = async (req, res) => {
  try {
    const { patientId } = req.params;
    const callerRole = req.user?.appRole || req.user?.user_metadata?.role || 'student';

    // Enforce patient ownership for student/teacher/patient roles
    if (['student', 'patient', 'teacher'].includes(callerRole)) {
      const userIdentifiers = await getUserPatientIdentifiers(req.user);
      const target = await resolveTargetPatientIdentifiers(patientId);
      const pIdLower = String(patientId).trim().toLowerCase();
      const isOwner = userIdentifiers.normalizedSet.has(pIdLower) ||
        target.canonicalIds.some((cid) => userIdentifiers.normalizedSet.has(cid.toLowerCase()));

      if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden: Access to another patient appointments is denied' });
      }
    }

    // Resolve target IDs so appointments stored with roll number or UUID are both fetched
    const target = await resolveTargetPatientIdentifiers(patientId);
    const queryIds = target.canonicalIds.length > 0 ? target.canonicalIds : [patientId];

    let query = supabase
      .from('appointments')
      .select('id, "patientId", "patientName", "doctorId", "doctorName", date, time, type, status, symptoms, "createdAt"');

    if (queryIds.length === 1 && typeof query.eq === 'function') {
      query = query.eq('patientId', queryIds[0]);
    } else if (typeof query.in === 'function') {
      query = query.in('patientId', queryIds);
    }

    if (typeof query.order === 'function') {
      query = query.order('createdAt', { ascending: false });
      if (typeof query.order === 'function') {
        query = query.order('id', { ascending: false });
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    const records = (data || []).map(unpackSymptoms);
    await enrichAppointmentsWithUniversityId(records);
    res.status(200).json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get appointments for a specific doctor
// @route   GET /api/appointments/doctor/:doctorId
export const getAppointmentsByDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const callerRole = req.user?.appRole || req.user?.user_metadata?.role || 'student';
    const callerId = String(req.user?.id || '').trim();

    // Doctors may only query their own appointments unless caller has staff/admin role
    if (callerRole === 'doctor' && callerId && doctorId && callerId !== doctorId) {
      return res.status(403).json({ error: 'Forbidden: Doctors may only inspect their own appointment rosters' });
    }

    let query = supabase
      .from('appointments')
      .select('id, "patientId", "patientName", "doctorId", "doctorName", date, time, type, status, symptoms, "createdAt"')
      .eq('doctorId', doctorId);

    if (typeof query.order === 'function') {
      query = query.order('createdAt', { ascending: false });
      if (typeof query.order === 'function') {
        query = query.order('id', { ascending: false });
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    const records = (data || []).map(unpackSymptoms);
    await enrichAppointmentsWithUniversityId(records);
    res.status(200).json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Delete appointment
// @route   DELETE /api/appointments/:id
export const deleteAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) throw error;
    res.status(200).json({ message: 'Appointment deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
