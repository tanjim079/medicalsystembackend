import express from 'express';
import supabase from '../config/supabase.js';
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

// Mount auth routes
router.use('/auth', authRoutes);

// Mount medicine routes
router.use('/medicines', medicineRoutes);

// Mount directory routes
router.use('/directory', directoryRoutes);

// Mount user routes
router.use('/users', userRoutes);

// Mount patient routes
router.use('/patients', patientRoutes);

// Mount appointment routes
router.use('/appointments', appointmentRoutes);

// Mount prescription routes
router.use('/prescriptions', prescriptionRoutes);

// Mount laboratory routes
router.use('/laboratory', laboratoryRoutes);

// Mount certificates routes
router.use('/certificates', certificateRoutes);

// Mount billing routes
router.use('/billing', billingRoutes);

// Mount medical tests routes
router.use('/tests', testRoutes);

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
