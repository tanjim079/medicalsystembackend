import express from 'express';
import {
  getDirectory,
  createDirectoryMember,
  updateDirectoryMember,
  deleteDirectoryMember
} from '../controllers/directoryController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public listing used by the website's Doctors and Staff pages
router.get('/', getDirectory);

// Administrative management of the public directory
router.post('/', requireAuth, requireRole(['admin']), createDirectoryMember);
router.put('/:id', requireAuth, requireRole(['admin']), updateDirectoryMember);
router.delete('/:id', requireAuth({ requireFreshSession: true }), requireRole(['admin']), deleteDirectoryMember);

export default router;
