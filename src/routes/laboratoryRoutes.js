import express from 'express';
import { 
  getLabRequests, 
  createLabRequest, 
  updateLabRequestStatus,
  getLabReports,
  createLabReport,
  updateLabReport
} from '../controllers/laboratoryController.js';

const router = express.Router();

router.get('/requests', getLabRequests);
router.post('/requests', createLabRequest);
router.put('/requests/:id/status', updateLabRequestStatus);

router.get('/reports', getLabReports);
router.post('/reports', createLabReport);
router.put('/reports/:id', updateLabReport);

export default router;
