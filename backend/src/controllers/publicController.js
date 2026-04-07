/**
 * Public Controller  —  /api/public
 *
 * Public-facing endpoints (no auth required).
 * Serves published CMS content, career listings, and accepts
 * job applications and support tickets.
 */

import prisma from '../config/postgres.js';
import { sendContactNotifyAdmin, sendContactConfirmation } from '../services/emailService.js';

// ─────────────────────────────────────────────────────────────
// CMS PAGES (Public)
// ─────────────────────────────────────────────────────────────

/* GET /api/public/cms-list — all published pages (title + slug only, for footer/nav) */
export const getPublishedCmsPageList = async (req, res, next) => {
  try {
    const pages = await prisma.cmsPage.findMany({
      where: { published: true },
      select: { slug: true, title: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: pages });
  } catch (error) {
    next(error);
  }
};

/* GET /api/public/cms/:slug */
export const getPublishedCmsPage = async (req, res, next) => {
  try {
    const page = await prisma.cmsPage.findUnique({
      where: { slug: req.params.slug },
    });

    if (!page || !page.published) {
      return res.status(404).json({ error: 'Page not found' });
    }

    res.json({ success: true, data: page });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// CAREER POSTINGS (Public)
// ─────────────────────────────────────────────────────────────

/* GET /api/public/careers */
export const getPublishedCareers = async (req, res, next) => {
  try {
    const careers = await prisma.careerPosting.findMany({
      where: { published: true },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { applications: true } },
      },
    });

    res.json({ success: true, data: careers });
  } catch (error) {
    next(error);
  }
};

/* GET /api/public/careers/:id */
export const getPublishedCareer = async (req, res, next) => {
  try {
    const career = await prisma.careerPosting.findUnique({
      where: { id: req.params.id },
    });

    if (!career || !career.published) {
      return res.status(404).json({ error: 'Job posting not found' });
    }

    res.json({ success: true, data: career });
  } catch (error) {
    next(error);
  }
};

/* POST /api/public/careers/:id/apply */
export const submitJobApplication = async (req, res, next) => {
  try {
    const { name, email, phone, coverLetter } = req.body;
    const careerPostingId = req.params.id;

    // Verify career posting exists and is published
    const posting = await prisma.careerPosting.findUnique({ where: { id: careerPostingId } });
    if (!posting || !posting.published) {
      return res.status(404).json({ error: 'Job posting not found or closed' });
    }

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    // Check for duplicate application
    const existing = await prisma.jobApplication.findFirst({
      where: { careerPostingId, email },
    });
    if (existing) {
      return res.status(400).json({ error: 'You have already applied for this position' });
    }

    const resumeUrl = req.file ? req.file.path : null;

    const application = await prisma.jobApplication.create({
      data: {
        careerPostingId,
        name,
        email,
        phone: phone || null,
        coverLetter: coverLetter || null,
        resumeUrl,
      },
    });

    res.status(201).json({ success: true, data: application, message: 'Application submitted successfully' });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// SUPPORT TICKETS (Public)
// ─────────────────────────────────────────────────────────────

/* POST /api/public/tickets */
export const createPublicTicket = async (req, res, next) => {
  try {
    const { name, email, subject, body, message } = req.body;
    const ticketBody = body || message; // accept either field name

    if (!email || !subject || !ticketBody) {
      return res.status(400).json({ error: 'Email, subject, and message are required' });
    }

    // Always store the ticket in the database
    const ticket = await prisma.supportTicket.create({
      data: {
        name: name || null,
        email,
        subject,
        body: ticketBody,
        status: 'open',
        priority: 'normal',
      },
    });

    // Send email notifications (non-blocking)
    sendContactNotifyAdmin(name, email, subject, ticketBody);
    sendContactConfirmation(email, name);

    res.status(201).json({ success: true, data: ticket, message: 'Support ticket created successfully' });
  } catch (error) {
    next(error);
  }
};
