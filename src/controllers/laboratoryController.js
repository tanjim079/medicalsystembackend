import supabase from '../config/supabase.js';

export const getLabRequests = async (req, res) => {
  try {
    const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 500) : null;
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { patientId, status } = req.query;

    let query = supabase
      .from('lab_requests')
      .select('id, "patientId", "patientName", "testId", "testName", category, "requestedBy", "requestedByName", priority, status, "createdAt"');

    if (patientId && typeof query.eq === 'function') {
      query = query.eq('patientId', patientId);
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

    const mapped = (data || []).map((record) => ({
      ...record,
      requestedAt: record.createdAt
    }));
    res.status(200).json(mapped);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createLabRequest = async (req, res) => {
  try {
    const payload = { ...req.body };
    delete payload.id;
    delete payload.requestedAt;

    const { data, error } = await supabase
      .from('lab_requests')
      .insert([payload])
      .select('id, "patientId", "patientName", "testId", "testName", category, "requestedBy", "requestedByName", priority, status, "createdAt"');

    if (error) throw error;

    const record = data[0];
    record.requestedAt = record.createdAt;
    res.status(201).json(record);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const updateLabRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data, error } = await supabase
      .from('lab_requests')
      .update({ status })
      .eq('id', id)
      .select('id, "patientId", "patientName", "testId", "testName", category, "requestedBy", "requestedByName", priority, status, "createdAt"');

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Lab request not found' });
    }

    const record = data[0];
    record.requestedAt = record.createdAt;
    res.status(200).json(record);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const unpackLabReport = (record) => {
  if (!record) return record;
  let unpacked = {};
  if (record.result) {
    try {
      const parsed = typeof record.result === 'string' ? JSON.parse(record.result) : record.result;
      if (parsed) unpacked = parsed;
    } catch (e) {}
  }
  const isFinalized = record.validated || unpacked.status === 'Completed' || unpacked.status === 'Validated';
  return {
    ...unpacked,
    id: record.id || '',
    patientId: record.patient_id || unpacked.patientId || record.patientId || '',
    patientName: unpacked.patientName || 'Unknown Patient',
    testName: record.test_name || unpacked.testName || record.testName || 'Unknown Test',
    status: isFinalized ? 'Completed' : (unpacked.status || 'Pending'),
    date: record.date || unpacked.date || new Date().toISOString().split('T')[0],
    requestedAt: unpacked.requestedAt || new Date().toISOString(),
    completedAt: unpacked.completedAt || unpacked.validatedAt || record.createdAt || new Date().toISOString(),
    validatedAt: unpacked.validatedAt || unpacked.completedAt || record.createdAt || new Date().toISOString()
  };
};

export const getLabReports = async (req, res) => {
  try {
    const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 500) : null;
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { patientId } = req.query;

    let query = supabase
      .from('lab_reports')
      .select('id, patient_id, test_name, result, validated, date');

    // Filter at DB level if patientId is provided
    if (patientId) {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId);
      if (isUUID && typeof query.eq === 'function') {
        query = query.eq('patient_id', patientId);
      } else if (typeof query.or === 'function') {
        query = query.or(`result.ilike.%"patientId":"${patientId}"%,result.ilike.%"patientId": "${patientId}"%,result.ilike.%"patient_id":"${patientId}"%,result.ilike.%"patient_id": "${patientId}"%`);
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

    res.status(200).json((data || []).map(unpackLabReport));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createLabReport = async (req, res) => {
  try {
    const frontendPayload = { ...req.body };
    const isCompleted = frontendPayload.status === 'Completed' || frontendPayload.status === 'Validated' || !frontendPayload.status;
    const dbPayload = {
      patient_id: null,
      test_name: frontendPayload.testName || 'Unknown',
      result: JSON.stringify({ ...frontendPayload, status: isCompleted ? 'Completed' : frontendPayload.status }),
      validated: isCompleted,
      date: new Date().toISOString().split('T')[0]
    };

    const { data, error } = await supabase
      .from('lab_reports')
      .insert([dbPayload])
      .select('id, patient_id, test_name, result, validated, date');

    if (error) throw error;

    // Automatically update the matching lab request status to Completed
    if (frontendPayload.requestId) {
      try {
        await supabase.from('lab_requests').update({ status: 'Completed' }).eq('id', frontendPayload.requestId);
      } catch (reqErr) {
        console.error('Failed to update matching lab request status:', reqErr);
      }
    }

    res.status(201).json(unpackLabReport(data[0]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const updateLabReport = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing, error: fetchErr } = await supabase
      .from('lab_reports')
      .select('id, patient_id, test_name, result, validated, date')
      .eq('id', id)
      .limit(1);

    if (fetchErr || !existing?.length) throw new Error('Report not found');

    let existingJson = {};
    if (existing[0].result) {
      try {
        existingJson = typeof existing[0].result === 'string' ? JSON.parse(existing[0].result) : existing[0].result;
      } catch (e) {}
    }

    const mergedJson = { ...existingJson, ...req.body };
    const isCompleted = mergedJson.status === 'Completed' || mergedJson.status === 'Validated' || req.body.status === 'Completed' || req.body.status === 'Validated' || existing[0].validated;
    const dbPayload = {
      result: JSON.stringify({ ...mergedJson, status: isCompleted ? 'Completed' : (mergedJson.status || 'Pending') }),
      validated: isCompleted
    };

    const { data, error } = await supabase
      .from('lab_reports')
      .update(dbPayload)
      .eq('id', id)
      .select('id, patient_id, test_name, result, validated, date');

    if (error) throw error;
    res.status(200).json(unpackLabReport(data[0]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
