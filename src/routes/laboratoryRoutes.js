import express from 'express';
import {
  getLabRequests,
  createLabRequest,
  updateLabRequestStatus,
  getLabReports,
  createLabReport,
  updateLabReport
} from '../controllers/laboratoryController.js';
import { requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/requests', getLabRequests);
router.post('/requests', createLabRequest);
router.put('/requests/:id/status', updateLabRequestStatus);

router.get('/reports', getLabReports);
router.post('/reports', requireRole(['admin', 'pathologist']), createLabReport);
router.put('/reports/:id', requireRole(['admin', 'pathologist']), updateLabReport);

export default router;
