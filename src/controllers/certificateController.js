import supabase from '../config/supabase.js';
import { getUserPatientIdentifiers, resolveTargetPatientIdentifiers } from '../services/recordAuthorization.js';

// @desc    Get certificates with scoping, filtering, and safe pagination
// @route   GET /api/certificates
export const getCertificates = async (req, res) => {
  try {
    const callerRole = req.user?.appRole || req.user?.user_metadata?.role || 'student';
    const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 500) : null;
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { patientId, doctorId } = req.query;

    let query = supabase
      .from('certificates')
      .select('id, "patientId", "patientName", "doctorId", "doctorName", date, diagnosis, "restStartDate", "restEndDate", "recommendedRestDays", remarks, "createdAt"');

    // Scoping for students/teachers/patients: restrict to own records only
    if (['student', 'patient', 'teacher'].includes(callerRole)) {
      const userIds = await getUserPatientIdentifiers(req.user);
      if (userIds.canonicalIds.length === 1 && typeof query.eq === 'function') {
        query = query.eq('patientId', userIds.canonicalIds[0]);
      } else if (typeof query.in === 'function') {
        query = query.in('patientId', userIds.canonicalIds);
      }
    } else {
      // Staff / Doctor filtering
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

    if (typeof query.order === 'function') {
      query = query.order('date', { ascending: false });
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
    res.status(200).json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Create medical certificate
// @route   POST /api/certificates
export const createCertificate = async (req, res) => {
  try {
    const payload = { ...req.body };
    delete payload.id;
    if (!payload.date) payload.date = new Date().toISOString();

    const { data, error } = await supabase
      .from('certificates')
      .insert([payload])
      .select('id, "patientId", "patientName", "doctorId", "doctorName", date, diagnosis, "restStartDate", "restEndDate", "recommendedRestDays", remarks, "createdAt"');

    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
