import express from 'express';
import supabase from '../config/supabase.js';
import { requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('bills').select('*').order('date', { ascending: false });
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', requireRole(['admin', 'receptionist']), async (req, res) => {
  try {
    const { data, error } = await supabase.from('bills').insert([req.body]).select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/:id/status', requireRole(['admin', 'receptionist']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { data, error } = await supabase.from('bills').update({ status }).eq('id', id).select();
    if (error) throw error;
    res.status(200).json(data[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;

