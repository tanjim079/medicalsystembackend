import supabase from '../config/supabase.js';

const unpackSymptoms = (record) => {
  if (record.symptoms && record.symptoms.startsWith('{')) {
    try {
      const parsed = JSON.parse(record.symptoms);
      record.symptoms = parsed.text;
      record.serialNumber = parsed.serialNumber;
    } catch(e) {}
  }
  return record;
};

export const getAppointments = async (req, res) => {
  try {
    const { data, error } = await supabase.from('appointments').select('*').order('createdAt', { ascending: false });
    if (error) throw error;
    res.status(200).json(data.map(unpackSymptoms));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createAppointment = async (req, res) => {
  try {
    const payload = { ...req.body };
    
    // Fix NOT NULL constraint for 'type' which isn't in frontend
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
    
    // Safety: delete ID if frontend sent a dummy one
    delete payload.id;
    delete payload.createdAt;

    const { data, error } = await supabase.from('appointments').insert([payload]).select();
    if (error) throw error;
    
    res.status(201).json(unpackSymptoms(data[0]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const updateAppointmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { data, error } = await supabase.from('appointments').update({ status }).eq('id', id).select();
    if (error) throw error;
    res.status(200).json(unpackSymptoms(data[0]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const getAppointmentsByPatient = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { data, error } = await supabase.from('appointments').select('*').eq('patientId', patientId).order('createdAt', { ascending: false });
    if (error) throw error;
    res.status(200).json(data.map(unpackSymptoms));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getAppointmentsByDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { data, error } = await supabase.from('appointments').select('*').eq('doctorId', doctorId).order('createdAt', { ascending: false });
    if (error) throw error;
    res.status(200).json(data.map(unpackSymptoms));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

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
