import express from 'express';
import { requireRole } from '../middleware/authMiddleware.js';
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  setUserStatus,
  resetUserPassword
} from '../controllers/userController.js';

const router = express.Router();

// Enforce admin role on all user management endpoints
router.use(requireRole(['admin']));

router.get('/', getUsers);
router.post('/', createUser);
router.get('/:id', getUserById);
router.put('/:id', updateUser);
router.patch('/:id/status', setUserStatus);
router.put('/:id/password', resetUserPassword);
router.delete('/:id', deleteUser);

export default router;
