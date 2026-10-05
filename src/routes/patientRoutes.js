import express from 'express';
import { getPatients, getPatientById, createPatient, updatePatient } from '../controllers/patientController.js';

const router = express.Router();

/**
 * @swagger
 * /patients:
 *   get:
 *     summary: Retrieve a list of all patients
 *     tags: [Patients]
 *     responses:
 *       200:
 *         description: A list of patients
 *       500:
 *         description: Server error
 *   post:
 *     summary: Create a new patient with full details
 *     tags: [Patients]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               name:
 *                 type: string
 *               roll_number:
 *                 type: string
 *               registration_number:
 *                 type: string
 *               phone:
 *                 type: string
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *                 example: "2003-05-14"
 *               blood_group:
 *                 type: string
 *               guardian_name:
 *                 type: string
 *               guardian_phone:
 *                 type: string
 *               department:
 *                 type: string
 *     responses:
 *       201:
 *         description: Patient registered successfully
 *       400:
 *         description: Bad request
 */
router.get('/', getPatients);
router.post('/', createPatient);

/**
 * @swagger
 * /patients/{id}:
 *   get:
 *     summary: Get comprehensive patient profile (including history and labs)
 *     tags: [Patients]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The Supabase user UUID or roll_number of the patient
 *     responses:
 *       200:
 *         description: Comprehensive patient profile
 *       500:
 *         description: Server error
 *       404:
 *         description: Patient not found
 *   put:
 *     summary: Update a patient's details
 *     tags: [Patients]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The Supabase user UUID or roll_number of the patient
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *               registration_number:
 *                 type: string
 *               blood_group:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Patient updated successfully
 *       400:
 *         description: Bad request
 */
router.get('/', getPatients);
router.get('/:id', getPatientById);
router.put('/:id', updatePatient);
router.post('/', createPatient);

export default router;
