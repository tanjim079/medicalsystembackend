import express from 'express';
import supabase from '../config/supabase.js';
import { requireAuth } from '../middleware/authMiddleware.js';

import authRoutes from './authRoutes.js';
import patientRoutes from './patientRoutes.js';
import appointmentRoutes from './appointmentRoutes.js';
import prescriptionRoutes from './prescriptionRoutes.js';
import laboratoryRoutes from './laboratoryRoutes.js';
import certificateRoutes from './certificateRoutes.js';
import billingRoutes from './billingRoutes.js';
import testRoutes from './testRoutes.js';
import userRoutes from './userRoutes.js';
import directoryRoutes from './directoryRoutes.js';
import medicineRoutes from './medicineRoutes.js';

const router = express.Router();

// Mount public routes
router.use('/auth', authRoutes);
router.use('/directory', directoryRoutes);
router.use('/medicines', medicineRoutes);
router.use('/tests', testRoutes);

// Apply authentication middleware for all subsequent routes
router.use(requireAuth);

// Mount protected routes
router.use('/users', userRoutes);
router.use('/patients', patientRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/prescriptions', prescriptionRoutes);
router.use('/laboratory', laboratoryRoutes);
router.use('/certificates', certificateRoutes);
router.use('/billing', billingRoutes);

// Example route to test Supabase connection
router.get('/test-db', async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('*').limit(1);
    
    if (error) throw error;
    
    res.json({ message: 'Supabase connection successful!', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
