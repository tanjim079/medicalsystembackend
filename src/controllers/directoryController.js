import supabase from '../config/supabase.js';

export const getDirectory = async (req, res) => {
  try {
    let query = supabase.from('staff_directory').select('*').order('id', { ascending: true });
    
    if (req.query.category) {
      query = query.eq('category', req.query.category);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
