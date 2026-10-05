import express from 'express';
import supabase from '../config/supabase.js';

const router = express.Router();

// GET /api/tests
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('medical_tests').select('*');
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tests (admin/staff only theoretically)
router.post('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('medical_tests').insert([req.body]).select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
