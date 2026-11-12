import supabase from '../config/supabase.js';
import { getUserPatientIdentifiers, resolveTargetPatientIdentifiers } from '../services/recordAuthorization.js';

const unpackPrescription = (record) => {
  if (!record) return record;
  let medicines = record.medicines;
  let tests = [];

  if (medicines && !Array.isArray(medicines) && medicines.items) {
    tests = medicines.tests || [];
    medicines = medicines.items;
  }

  return {
    ...record,
    problem: record.diagnosis,
    medicines,
    tests
  };
};

// @desc    Get prescriptions with role scoping, filtering, and safe pagination
// @route   GET /api/prescriptions
export const getPrescriptions = async (req, res) => {
  try {
    const callerRole = req.user?.appRole || req.user?.user_metadata?.role || 'student';
    const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 500) : null;
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { patientId, doctorId, status } = req.query;

    let query = supabase
      .from('prescriptions')
      .select('id, "patientId", "patientName", "doctorId", "doctorName", date, diagnosis, medicines, advice, status, "createdAt"');

    // Scoping for students/teachers/patients: restrict to own records only
    if (['student', 'patient', 'teacher'].includes(callerRole)) {
      const userIds = await getUserPatientIdentifiers(req.user);
      if (userIds.canonicalIds.length === 1 && typeof query.eq === 'function') {
        query = query.eq('patientId', userIds.canonicalIds[0]);
      } else if (typeof query.in === 'function') {
        query = query.in('patientId', userIds.canonicalIds);
      }
    } else {
      // Staff / Doctor / Pharmacist filtering
      if (patientId) {
        const target = await resolveTargetPatientIdentifiers(patientId);
        const pIds = target.canonicalIds.length > 0 ? target.canonicalIds : [patientId];
        if (pIds.length === 1 && typeof query.eq === 'function') {
          query = query.eq('patientId', pIds[0]);
        } else if (typeof query.in === 'function') {
          query = query.in('patientId', pIds);
        }
      }
      if (doctorId && typeof query.eq === 'function') {
        query = query.eq('doctorId', doctorId);
      }
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

    res.status(200).json((data || []).map(unpackPrescription));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Create new prescription
// @route   POST /api/prescriptions
export const createPrescription = async (req, res) => {
  try {
    const payload = { ...req.body };
    delete payload.id;

    const testsToSave = payload.tests || [];
    delete payload.tests;

    if (payload.problem) {
      payload.diagnosis = payload.problem;
      delete payload.problem;
    }

    if (!payload.date) payload.date = new Date().toISOString();
    if (!payload.status) payload.status = 'pending';

    // Optimize patient identity & name resolution concurrently
    if (!payload.patientName || payload.patientName === 'Unknown Patient') {
      try {
        const patientIdStr = String(payload.patientId || '').trim();
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientIdStr);

        if (isUUID) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', patientIdStr)
            .maybeSingle();

          if (prof?.name) payload.patientName = prof.name;
        } else {
          // Concurrently search patients table and teachers table
          const [ptRes, tchRes] = await Promise.all([
            supabase.from('patients').select('id, roll_number').eq('roll_number', patientIdStr).maybeSingle(),
            supabase.from('teachers').select('id, name').eq('employee_id', patientIdStr).maybeSingle()
          ]);

          if (tchRes?.data?.name) {
            payload.patientName = tchRes.data.name;
          } else if (ptRes?.data?.id) {
            const { data: prof2 } = await supabase
              .from('profiles')
              .select('name')
              .eq('id', ptRes.data.id)
              .maybeSingle();

            if (prof2?.name) payload.patientName = prof2.name;
          }
        }
      } catch (e) {
        console.warn('Error resolving patient name in prescription creation:', e.message);
      }

      if (!payload.patientName) {
        payload.patientName = 'Unknown Patient';
      }
    }

    // Pack tests inside medicines JSONB
    payload.medicines = {
      items: payload.medicines || [],
      tests: testsToSave
    };

    const { data, error } = await supabase
      .from('prescriptions')
      .insert([payload])
      .select('id, "patientId", "patientName", "doctorId", "doctorName", date, diagnosis, medicines, advice, status, "createdAt"');

    if (error) throw error;

    res.status(201).json(unpackPrescription(data[0]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Update prescription status
// @route   PUT /api/prescriptions/:id/status
export const updatePrescriptionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data, error } = await supabase
      .from('prescriptions')
      .update({ status })
      .eq('id', id)
      .select('id, "patientId", "patientName", "doctorId", "doctorName", date, diagnosis, medicines, advice, status, "createdAt"');

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Prescription not found' });
    }

    res.status(200).json(unpackPrescription(data[0]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
