import express from 'express';
import { requireRole } from '../middleware/authMiddleware.js';
import { getUsers, createUser, updateUser, deleteUser } from '../controllers/userController.js';

const router = express.Router();

// Enforce admin role on all user management endpoints
router.use(requireRole(['admin']));

router.get('/', getUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

export default router;
