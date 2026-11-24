import supabase from '../config/supabase.js';

let testMedicinesData = null;

export const setTestMedicinesData = (data) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Security Error: setTestMedicinesData cannot be invoked in production.');
  }
  testMedicinesData = data;
};

// @desc    Get all medicines
// @route   GET /api/medicines
export const getMedicines = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('medicines')
      .select('id, name, stock')
      .order('name', { ascending: true });

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const isValidStock = (v) => Number.isInteger(v) && v >= 0 && v <= 1000000;

// @desc    Update medicine stock and/or name
// @route   PUT /api/medicines/:id   { stock?: number, name?: string }
export const updateMedicineStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { stock, name } = req.body || {};
    const update = {};

    if (stock !== undefined) {
      if (typeof stock !== 'number' || !isValidStock(stock)) {
        return res.status(400).json({ error: 'Please provide a valid stock number (whole number, 0 or more)' });
      }
      update.stock = stock;
    }

    if (name !== undefined) {
      const role = req.user?.appRole || req.user?.user_metadata?.role;
      if (role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Only administrators can rename medicines' });
      }
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) {
        return res.status(400).json({ error: 'Medicine name must be between 2 and 120 characters' });
      }
      update.name = name.trim();
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Please provide a valid stock number' });
    }

    if (process.env.NODE_ENV !== 'production' && testMedicinesData) {
      return res.status(200).json({ id, ...update });
    }

    const { data, error } = await supabase
      .from('medicines')
      .update(update)
      .eq('id', id)
      .select('id, name, stock')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Medicine not found' });
    res.status(200).json(data);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A medicine with this name already exists' });
    res.status(500).json({ error: error.message });
  }
};

// @desc    Adjust stock by a delta (restock or write-off)
// @route   PATCH /api/medicines/:id/adjust   { delta: number }
export const adjustMedicineStock = async (req, res) => {
  try {
    const { id } = req.params;
    const delta = req.body?.delta;
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000000) {
      return res.status(400).json({ error: '`delta` must be a non-zero whole number' });
    }

    const { data: current, error: readError } = await supabase
      .from('medicines').select('id, name, stock').eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!current) return res.status(404).json({ error: 'Medicine not found' });

    const next = (Number(current.stock) || 0) + delta;
    if (next < 0) {
      return res.status(400).json({ error: `Cannot remove ${Math.abs(delta)} units; only ${current.stock} in stock` });
    }

    // Optimistic concurrency: only apply if stock hasn't changed since it was read.
    const { data, error } = await supabase
      .from('medicines')
      .update({ stock: next })
      .eq('id', id)
      .eq('stock', current.stock)
      .select('id, name, stock')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'Stock changed while updating; please retry' });
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Delete a medicine
// @route   DELETE /api/medicines/:id
export const deleteMedicine = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('medicines').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: 'Medicine not found' });
    res.status(200).json({ id, message: 'Medicine deleted' });
  } catch (error) {
    if (error.code === '23503') return res.status(409).json({ error: 'Medicine is referenced by other records and cannot be deleted' });
    res.status(500).json({ error: error.message });
  }
};

// @desc    Add new medicine
// @route   POST /api/medicines
export const addMedicine = async (req, res) => {
  try {
    const { name, stock } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Medicine name is required' });
    }
    if (stock !== undefined && stock !== null && (typeof stock !== 'number' || !isValidStock(stock))) {
      return res.status(400).json({ error: 'Initial stock must be a whole number, 0 or more' });
    }

    if (process.env.NODE_ENV !== 'production' && testMedicinesData) {
      return res.status(201).json({ id: 'mock-med-1', name, stock });
    }

    const { data, error } = await supabase
      .from('medicines')
      .insert([{ name: name.trim(), stock: stock || 0 }])
      .select('id, name, stock')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A medicine with this name already exists' });
    res.status(500).json({ error: error.message });
  }
};
