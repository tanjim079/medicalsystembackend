import express from 'express';
import { getDirectory } from '../controllers/directoryController.js';

const router = express.Router();

router.get('/', getDirectory);

export default router;
