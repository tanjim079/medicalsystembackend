import supabase from '../config/supabase.js';

// @desc    Get all medicines
// @route   GET /api/medicines
export const getMedicines = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('medicines')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Update medicine stock
// @route   PUT /api/medicines/:id
export const updateMedicineStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { stock } = req.body;

    if (typeof stock !== 'number') {
      return res.status(400).json({ error: 'Please provide a valid stock number' });
    }

    const { data, error } = await supabase
      .from('medicines')
      .update({ stock })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Add new medicine
// @route   POST /api/medicines
export const addMedicine = async (req, res) => {
  try {
    const { name, stock } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Medicine name is required' });
    }

    const { data, error } = await supabase
      .from('medicines')
      .insert([{ name, stock: stock || 0 }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
