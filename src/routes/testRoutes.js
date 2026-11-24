import express from 'express';
import { z } from 'zod';
import supabase from '../config/supabase.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

const TEST_CATEGORIES = ['Pathology', 'ECG', 'Ultrasonography', 'Radiology', 'Other'];

const priceSchema = z.coerce.number().min(0, 'Price cannot be negative').max(1000000);

const testSchema = z.object({
  id: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(2, 'Test name must be at least 2 characters').max(160),
  category: z.enum(TEST_CATEGORIES, { message: `Category must be one of: ${TEST_CATEGORIES.join(', ')}` }),
  studentPrice: priceSchema,
  employeePrice: priceSchema
});

const formatZodError = (err) => ({
  error: 'Validation Error',
  details: (err.issues || []).map((i) => ({ field: i.path.join('.'), message: i.message }))
});

// Generates the next "T-###" identifier for catalogs that use text primary keys.
const nextTestId = async () => {
  const { data } = await supabase.from('medical_tests').select('id');
  const max = (data || []).reduce((m, t) => {
    const match = /^T-(\d+)$/.exec(String(t.id));
    return match ? Math.max(m, parseInt(match[1], 10)) : m;
  }, 0);
  return `T-${String(max + 1).padStart(3, '0')}`;
};

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

// POST /api/tests — add a test to the catalog
router.post('/', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  const parsed = testSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  try {
    const row = { ...parsed.data };
    let { data, error } = await supabase.from('medical_tests').insert([row]).select();

    // Text primary keys without defaults reject inserts lacking an id (23502): generate one and retry.
    if (error && error.code === '23502' && !row.id) {
      row.id = await nextTestId();
      ({ data, error } = await supabase.from('medical_tests').insert([row]).select());
    }
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A test with this ID or name already exists' });
      throw error;
    }
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/tests/:id — update catalog entry
router.put('/:id', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  const parsed = testSchema.omit({ id: true }).partial().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: 'No fields to update' });

  try {
    const { data, error } = await supabase
      .from('medical_tests').update(parsed.data).eq('id', req.params.id).select();
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: 'Test not found' });
    res.status(200).json(data[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/tests/:id — remove from catalog
router.delete('/:id', requireAuth({ requireFreshSession: true }), requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabase.from('medical_tests').delete().eq('id', req.params.id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: 'Test not found' });
    res.status(200).json({ id: req.params.id, message: 'Test deleted' });
  } catch (error) {
    if (error.code === '23503') return res.status(409).json({ error: 'Test is referenced by other records and cannot be deleted' });
    res.status(400).json({ error: error.message });
  }
});

export default router;
