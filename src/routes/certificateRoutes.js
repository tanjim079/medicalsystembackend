import express from 'express';
import { getCertificates, createCertificate } from '../controllers/certificateController.js';
import { requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getCertificates);
router.post('/', requireRole(['admin', 'doctor']), createCertificate);

export default router;
