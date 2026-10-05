import supabase from '../config/supabase.js';

const unpackPrescription = (record) => {
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

export const getPrescriptions = async (req, res) => {
  try {
    const { data, error } = await supabase.from('prescriptions').select('*').order('createdAt', { ascending: false });
    if (error) throw error;
    
    res.status(200).json(data.map(unpackPrescription));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createPrescription = async (req, res) => {
  try {
    const payload = { ...req.body };
    delete payload.id;
    
    const testsToSave = payload.tests || [];
    delete payload.tests; // Not in schema
    
    if (payload.problem) {
      payload.diagnosis = payload.problem;
      delete payload.problem;
    }
    
    // Default values if missing
    if (!payload.date) payload.date = new Date().toISOString();
    if (!payload.status) payload.status = 'pending';
    
    if (!payload.patientName) {
      const { data: pt } = await supabase.from('patients').select('name').eq('roll_number', payload.patientId).single();
      payload.patientName = pt ? pt.name : 'Unknown Patient';
    }
    
    // Pack tests inside medicines JSONB
    payload.medicines = {
      items: payload.medicines || [],
      tests: testsToSave
    };
    
    const { data, error } = await supabase.from('prescriptions').insert([payload]).select();
    if (error) throw error;
    
    res.status(201).json(unpackPrescription(data[0]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const updatePrescriptionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { data, error } = await supabase.from('prescriptions').update({ status }).eq('id', id).select();
    if (error) throw error;
    res.status(200).json(unpackPrescription(data[0]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
