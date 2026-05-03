/**
 * Public Controller  —  /api/public
 *
 * Public-facing endpoints (no auth required).
 * Serves published CMS content, career listings, and accepts
 * job applications and support tickets.
 */

import type { Request, Response, NextFunction } from 'express';
import prisma from '../config/postgres.js';
import { sendContactNotifyAdmin, sendContactConfirmation } from '../services/emailService.js';

// ─────────────────────────────────────────────────────────────
// CMS PAGES (Public)
// ─────────────────────────────────────────────────────────────

/* GET /api/public/cms-list — all published pages (title + slug only, for footer/nav) */
export const getPublishedCmsPageList = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
export const getPublishedCmsPage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = await prisma.cmsPage.findUnique({
      where: { slug: req.params.slug },
    });

    if (!page || !page.published) {
      res.status(404).json({ error: 'Page not found' });
      return;
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
export const getPublishedCareers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
export const getPublishedCareer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const career = await prisma.careerPosting.findUnique({
      where: { id: req.params.id },
    });

    if (!career || !career.published) {
      res.status(404).json({ error: 'Job posting not found' });
      return;
    }

    res.json({ success: true, data: career });
  } catch (error) {
    next(error);
  }
};

interface JobAppBody {
  name?: string;
  email?: string;
  phone?: string | null;
  coverLetter?: string | null;
}

/* POST /api/public/careers/:id/apply */
export const submitJobApplication = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, phone, coverLetter } = req.body as JobAppBody;
    const careerPostingId = req.params.id;

    // Verify career posting exists and is published
    const posting = await prisma.careerPosting.findUnique({ where: { id: careerPostingId } });
    if (!posting || !posting.published) {
      res.status(404).json({ error: 'Job posting not found or closed' });
      return;
    }

    if (!name || !email) {
      res.status(400).json({ error: 'Name and email are required' });
      return;
    }

    // Check for duplicate application
    const existing = await prisma.jobApplication.findFirst({
      where: { careerPostingId, email },
    });
    if (existing) {
      res.status(400).json({ error: 'You have already applied for this position' });
      return;
    }

    const resumeUrl = (req as Request & { file?: { path?: string } }).file?.path || null;

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

interface PublicTicketBody {
  name?: string | null;
  email?: string;
  subject?: string;
  body?: string;
  message?: string;
}

/* POST /api/public/tickets */
export const createPublicTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, subject, body, message } = req.body as PublicTicketBody;
    const ticketBody = body || message; // accept either field name

    if (!email || !subject || !ticketBody) {
      res.status(400).json({ error: 'Email, subject, and message are required' });
      return;
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
    sendContactNotifyAdmin(name || null, email, subject, ticketBody);
    sendContactConfirmation(email, name || null);

    res.status(201).json({ success: true, data: ticket, message: 'Support ticket created successfully' });
  } catch (error) {
    next(error);
  }
};
