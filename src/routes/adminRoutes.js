import express from 'express';
import { requireRole } from '../middleware/authMiddleware.js';
import { getStats, getActivity } from '../controllers/adminController.js';

const router = express.Router();

router.use(requireRole(['admin']));

router.get('/stats', getStats);
router.get('/activity', getActivity);

export default router;
