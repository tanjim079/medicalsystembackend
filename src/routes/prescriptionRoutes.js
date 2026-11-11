import express from 'express';
import { getPrescriptions, createPrescription, updatePrescriptionStatus } from '../controllers/prescriptionController.js';
import { requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getPrescriptions);
router.post('/', requireRole(['admin', 'doctor']), createPrescription);
router.put('/:id/status', requireRole(['admin', 'pharmacist', 'doctor']), updatePrescriptionStatus);

export default router;
