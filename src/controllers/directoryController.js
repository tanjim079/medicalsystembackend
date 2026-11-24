import { z } from 'zod';
import supabase from '../config/supabase.js';

const memberSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  category: z.enum(['doctor', 'staff'], { message: 'Category must be doctor or staff' }),
  designation: z.string().trim().min(2, 'Designation is required').max(160),
  contact: z.string().trim().max(40).optional().default(''),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Invalid email address')]).optional().default('')
});

const formatZodError = (err) => ({
  error: 'Validation Error',
  details: (err.issues || []).map((i) => ({ field: i.path.join('.'), message: i.message }))
});

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

export const createDirectoryMember = async (req, res) => {
  const parsed = memberSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
  try {
    const { data, error } = await supabase.from('staff_directory').insert([parsed.data]).select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const updateDirectoryMember = async (req, res) => {
  const parsed = memberSchema.partial().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
  // Drop defaulted-but-not-provided fields so partial updates don't blank existing values.
  const update = Object.fromEntries(Object.entries(parsed.data).filter(([k]) => k in (req.body || {})));
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No fields to update' });
  try {
    const { data, error } = await supabase.from('staff_directory').update(update).eq('id', req.params.id).select();
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: 'Directory entry not found' });
    res.status(200).json(data[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteDirectoryMember = async (req, res) => {
  try {
    const { data, error } = await supabase.from('staff_directory').delete().eq('id', req.params.id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: 'Directory entry not found' });
    res.status(200).json({ id: req.params.id, message: 'Directory entry deleted' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
