import supabase from '../config/supabase.js';

export const getLabRequests = async (req, res) => {
  try {
    const { data, error } = await supabase.from('lab_requests').select('*');
    if (error) throw error;
    
    const mapped = data.map(record => ({
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
    delete payload.id; // Supabase generates UUID
    delete payload.requestedAt; // We use createdAt
    
    const { data, error } = await supabase.from('lab_requests').insert([payload]).select();
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
    const { data, error } = await supabase.from('lab_requests').update({ status }).eq('id', id).select();
    if (error) throw error;
    
    const record = data[0];
    record.requestedAt = record.createdAt;
    res.status(200).json(record);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const unpackLabReport = (record) => {
  let unpacked = {};
  if (record.result) {
    try { 
      const parsed = JSON.parse(record.result); 
      if (parsed) unpacked = parsed;
    } catch(e) {}
  }
  return {
    ...unpacked,
    id: record.id || '',
    patientId: record.patient_id || unpacked.patientId || '',
    patientName: unpacked.patientName || 'Unknown Patient',
    testName: record.test_name || unpacked.testName || 'Unknown Test',
    status: record.validated ? 'Validated' : (unpacked.status || 'Awaiting Validation'),
    date: record.date || unpacked.date || new Date().toISOString().split('T')[0],
    requestedAt: unpacked.requestedAt || new Date().toISOString()
  };
};

export const getLabReports = async (req, res) => {
  try {
    const { data, error } = await supabase.from('lab_reports').select('*');
    if (error) throw error;
    res.status(200).json(data.map(unpackLabReport));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createLabReport = async (req, res) => {
  try {
    const frontendPayload = { ...req.body };
    const dbPayload = {
      patient_id: null, // Bypass strict UUID constraint (student ID is stored in result)
      test_name: frontendPayload.testName || 'Unknown',
      result: JSON.stringify(frontendPayload),
      validated: frontendPayload.status === 'Validated',
      date: new Date().toISOString().split('T')[0]
    };

    const { data, error } = await supabase.from('lab_reports').insert([dbPayload]).select();
    if (error) throw error;
    
    res.status(201).json(unpackLabReport(data[0]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const updateLabReport = async (req, res) => {
  try {
    const { id } = req.params;
    
    // First fetch existing
    const { data: existing, error: fetchErr } = await supabase.from('lab_reports').select('*').eq('id', id).limit(1);
    if (fetchErr || !existing.length) throw new Error('Report not found');
    
    let existingJson = {};
    if (existing[0].result) {
      try { existingJson = JSON.parse(existing[0].result); } catch(e) {}
    }
    
    const mergedJson = { ...existingJson, ...req.body };
    const dbPayload = {
      result: JSON.stringify(mergedJson),
      validated: mergedJson.status === 'Validated' || req.body.status === 'Validated'
    };
    
    const { data, error } = await supabase.from('lab_reports').update(dbPayload).eq('id', id).select();
    if (error) throw error;
    res.status(200).json(unpackLabReport(data[0]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
