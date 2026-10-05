import express from 'express';
import { getMedicines, updateMedicineStock, addMedicine } from '../controllers/medicineController.js';

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Medicine:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         stock:
 *           type: integer
 *         createdAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /medicines:
 *   get:
 *     summary: Get all medicines
 *     tags: [Medicines]
 *     responses:
 *       200:
 *         description: List of all medicines
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Medicine'
 */
router.get('/', getMedicines);

/**
 * @swagger
 * /medicines/{id}:
 *   put:
 *     summary: Update medicine stock
 *     tags: [Medicines]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stock:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Medicine stock updated successfully
 */
router.put('/:id', updateMedicineStock);

/**
 * @swagger
 * /medicines:
 *   post:
 *     summary: Add a new medicine
 *     tags: [Medicines]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               stock:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Medicine added successfully
 */
router.post('/', addMedicine);

export default router;
