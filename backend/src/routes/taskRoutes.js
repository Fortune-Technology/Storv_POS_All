import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { listTasks, createTask, updateTask, deleteTask, myTasks, taskCounts } from '../controllers/taskController.js';

const router = Router();
router.use(protect);
router.use(scopeToTenant);

router.get('/',         listTasks);
router.post('/',        createTask);
router.get('/my',       myTasks);
router.get('/counts',   taskCounts);
router.put('/:id',      updateTask);
router.delete('/:id',   deleteTask);

export default router;
