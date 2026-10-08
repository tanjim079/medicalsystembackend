import express from 'express';
import supabase from '../config/supabase.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/tests
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('medical_tests').select('*');
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

// POST /api/tests (admin/staff only theoretically)
router.post('/', requireAuth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('medical_tests').insert([req.body]).select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
