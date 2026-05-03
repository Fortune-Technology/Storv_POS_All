/**
 * Public Routes  —  /api/public
 *
 * No authentication required.
 * Serves published content and accepts public submissions.
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import {
  getPublishedCmsPageList,
  getPublishedCmsPage,
  getPublishedCareers,
  getPublishedCareer,
  submitJobApplication,
  createPublicTicket,
} from '../controllers/publicController.js';

const router = Router();

// Resume upload config
const resumeStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'resume-' + uniqueSuffix + path.extname(file.originalname));
  },
});
const resumeUpload = multer({
  storage: resumeStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF and Word documents are allowed'));
  },
});

// CMS pages
router.get('/cms-list', getPublishedCmsPageList);  // list all published (title+slug only)
router.get('/cms/:slug', getPublishedCmsPage);      // single page by slug

// Career postings
router.get('/careers', getPublishedCareers);
router.get('/careers/:id', getPublishedCareer);
router.post('/careers/:id/apply', resumeUpload.single('resume'), submitJobApplication);

// Support tickets
router.post('/tickets', createPublicTicket);

export default router;
