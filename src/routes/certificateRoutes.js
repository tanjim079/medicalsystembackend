import express from 'express';
import { getCertificates, createCertificate } from '../controllers/certificateController.js';

const router = express.Router();

router.get('/', getCertificates);
router.post('/', createCertificate);

export default router;
