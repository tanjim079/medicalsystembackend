import express from 'express';
import { getAppointments, createAppointment, updateAppointmentStatus, getAppointmentsByPatient, getAppointmentsByDoctor, deleteAppointment } from '../controllers/appointmentController.js';

const router = express.Router();

router.get('/', getAppointments);
router.post('/', createAppointment);
router.get('/patient/:patientId', getAppointmentsByPatient);
router.get('/doctor/:doctorId', getAppointmentsByDoctor);
router.put('/:id/status', updateAppointmentStatus);
router.delete('/:id', deleteAppointment);

export default router;
