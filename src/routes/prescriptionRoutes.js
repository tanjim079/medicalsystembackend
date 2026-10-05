import express from 'express';
import { getPrescriptions, createPrescription, updatePrescriptionStatus } from '../controllers/prescriptionController.js';

const router = express.Router();

router.get('/', getPrescriptions);
router.post('/', createPrescription);
router.put('/:id/status', updatePrescriptionStatus);

export default router;
