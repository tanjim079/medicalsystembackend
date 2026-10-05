import supabase from '../config/supabase.js';

export const getCertificates = async (req, res) => {
  try {
    const { data, error } = await supabase.from('certificates').select('*').order('date', { ascending: false });
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createCertificate = async (req, res) => {
  try {
    const payload = { ...req.body };
    delete payload.id;
    if (!payload.date) payload.date = new Date().toISOString();
    const { data, error } = await supabase.from('certificates').insert([payload]).select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
