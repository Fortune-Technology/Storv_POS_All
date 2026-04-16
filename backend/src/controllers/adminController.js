/**
 * Admin Controller  —  /api/admin
 *
 * System-level admin endpoints for superadmin users.
 * NOT scoped to any org — these manage ALL users, orgs, content.
 */

import prisma from '../config/postgres.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { sendUserApproved, sendUserRejected, sendUserSuspended } from '../services/emailService.js';

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/dashboard */
export const getDashboardStats = async (req, res, next) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers, pendingUsers, totalOrgs, activeOrgs, openTickets,
      recentUsers, recentOrgs, recentTickets,
      usersByRole, orgsByPlan,
      signupUsers, signupOrgs,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'pending' } }),
      prisma.organization.count(),
      prisma.organization.count({ where: { isActive: true } }),
      prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
      // Recent users
      prisma.user.findMany({
        take: 5, orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
      }),
      // Recent orgs
      prisma.organization.findMany({
        take: 5, orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, plan: true, createdAt: true, _count: { select: { users: true, stores: true } } },
      }),
      // Recent tickets
      prisma.supportTicket.findMany({
        take: 5, orderBy: { createdAt: 'desc' },
        select: { id: true, subject: true, status: true, priority: true, createdAt: true },
      }).catch(() => []),
      // Users by role
      prisma.user.groupBy({ by: ['role'], _count: true }).catch(() => []),
      // Orgs by plan
      prisma.organization.groupBy({ by: ['plan'], _count: true }).catch(() => []),
      // Signups last 7 days (users)
      prisma.user.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: sevenDaysAgo } },
        _count: true,
      }).catch(() => []),
      // Signups last 7 days (orgs)
      prisma.organization.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: sevenDaysAgo } },
        _count: true,
      }).catch(() => []),
    ]);

    // Build 7-day chart data
    const usersByDay = {};
    for (const u of signupUsers) {
      const day = new Date(u.createdAt).toISOString().split('T')[0];
      usersByDay[day] = (usersByDay[day] || 0) + u._count;
    }
    const orgsByDay = {};
    for (const o of signupOrgs) {
      const day = new Date(o.createdAt).toISOString().split('T')[0];
      orgsByDay[day] = (orgsByDay[day] || 0) + o._count;
    }
    const chartData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      chartData.push({ date: key, users: usersByDay[key] || 0, orgs: orgsByDay[key] || 0 });
    }

    res.json({
      success: true,
      data: {
        totalUsers, pendingUsers, totalOrgs, activeOrgs, openTickets,
        recentUsers,
        recentOrgs: recentOrgs.map(o => ({ ...o, userCount: o._count.users, storeCount: o._count.stores, _count: undefined })),
        recentTickets,
        chartData,
        usersByRole: usersByRole.reduce((acc, r) => { acc[r.role] = r._count; return acc; }, {}),
        orgsByPlan: orgsByPlan.reduce((acc, p) => { acc[p.plan || 'none'] = p._count; return acc; }, {}),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// USER MANAGEMENT (cross-org)
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/users?status=pending&search=john&page=1&limit=25 */
export const getAllUsers = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, phone: true,
          role: true, status: true, orgId: true, createdAt: true,
          organization: { select: { id: true, name: true, slug: true, plan: true, isActive: true } },
          stores: { select: { store: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.user.count({ where }),
    ]);

    const result = users.map(u => ({
      ...u,
      stores: u.stores.map(s => s.store),
    }));

    res.json({ success: true, data: result, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/users/:id/approve */
export const approveUser = async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data:  { status: 'active' },
      select: { id: true, name: true, email: true, status: true, orgId: true },
    });

    // Also activate the user's organization (if it was created during onboarding)
    if (user.orgId && user.orgId !== 'default') {
      await prisma.organization.update({
        where: { id: user.orgId },
        data:  { isActive: true },
      });
    }

    sendUserApproved(user.email, user.name);
    res.json({ success: true, data: user, message: 'User approved successfully' });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/users/:id/suspend */
export const suspendUser = async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data:  { status: 'suspended' },
      select: { id: true, name: true, email: true, status: true },
    });

    sendUserSuspended(user.email, user.name);
    res.json({ success: true, data: user, message: 'User suspended' });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/users/:id/reject */
export const rejectUser = async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data:  { status: 'suspended' },
      select: { id: true, name: true, email: true, status: true },
    });

    // Deactivate the org too if it exists
    if (user.orgId && user.orgId !== 'default') {
      await prisma.organization.update({
        where: { id: user.orgId },
        data:  { isActive: false, deactivatedAt: new Date() },
      }).catch(() => {}); // ignore if org doesn't exist
    }

    sendUserRejected(user.email, user.name);
    res.json({ success: true, data: user, message: 'User rejected' });
  } catch (error) {
    next(error);
  }
};

/**
 * Generate a cryptographically random 16-char password that satisfies the
 * policy in utils/validators.js (upper, lower, digit, special).
 */
function generateTempPassword() {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghjkmnpqrstuvwxyz';
  const digits  = '23456789';
  const special = '!@#$%^&*-_+=';
  const all = upper + lower + digits + special;
  const pick = (set) => set[crypto.randomInt(0, set.length)];
  // Guarantee one of each class, then fill to length 16
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < 16) chars.push(pick(all));
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/* POST /api/admin/users — create user */
export const createUser = async (req, res, next) => {
  try {
    const { name, email, phone, role, orgId, status } = req.body;
    if (!name || !email || !orgId) return res.status(400).json({ error: 'Name, email, and organization are required' });

    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existing) return res.status(400).json({ error: 'A user with this email already exists' });

    // Generate a fresh random password per user. Do NOT reuse a hardcoded
    // "Temp@1234" (found in prior audits). The plaintext is returned ONCE in
    // this response so the admin can hand it off securely; it is never logged.
    const plainTemp = generateTempPassword();
    const hashed = await bcrypt.hash(plainTemp, 12);
    const user = await prisma.user.create({
      data: {
        name:   name.trim(),
        email:  email.trim().toLowerCase(),
        phone:  phone || null,
        password: hashed,
        role:   role || 'staff',
        orgId,
        status: status || 'active',
      },
      select: { id: true, name: true, email: true, role: true, status: true, orgId: true, createdAt: true },
    });

    // Return the temp password exactly once. Admin must deliver it out-of-band.
    // (A future enhancement is a `mustChangePassword` flag + forced-change flow.)
    res.status(201).json({
      success: true,
      data: user,
      tempPassword: plainTemp,
      notice: 'Deliver this temporary password to the user securely. It will not be shown again.',
    });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/users/:id — update user */
export const updateUser = async (req, res, next) => {
  try {
    const { name, email, phone, role, status, orgId } = req.body;
    const data = {};
    if (name !== undefined)   data.name = name;
    if (email !== undefined)  data.email = email;
    if (phone !== undefined)  data.phone = phone;
    if (role !== undefined)   data.role = role;
    if (status !== undefined) data.status = status;
    if (orgId !== undefined)  data.orgId = orgId;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, status: true, orgId: true },
    });

    res.json({ success: true, data: user });
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Email already in use' });
    next(error);
  }
};

/* DELETE /api/admin/users/:id — soft delete (suspend) */
export const softDeleteUser = async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { status: 'suspended' },
      select: { id: true, name: true, email: true, status: true },
    });
    res.json({ success: true, data: user, message: 'User suspended (soft delete)' });
  } catch (error) {
    next(error);
  }
};

/* POST /api/admin/users/:id/impersonate — login as user */
export const impersonateUser = async (req, res, next) => {
  try {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, role: true, status: true, orgId: true,
                stores: { select: { storeId: true } } },
    });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'superadmin') return res.status(403).json({ error: 'Cannot impersonate another superadmin' });

    const token = jwt.sign(
      { id: target.id, name: target.name, email: target.email, role: target.role, impersonatedBy: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: '2h' },
    );

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: target.id, name: target.name, email: target.email,
          role: target.role, status: target.status, orgId: target.orgId,
          storeIds: target.stores.map(s => s.storeId),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// ORGANIZATION MANAGEMENT
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/organizations?search=acme&page=1&limit=25 */
export const getAllOrganizations = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [orgs, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        include: {
          _count: { select: { users: true, stores: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.organization.count({ where }),
    ]);

    res.json({ success: true, data: orgs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/organizations/:id */
export const updateOrganization = async (req, res, next) => {
  try {
    const { plan, maxStores, maxUsers, isActive } = req.body;
    const data = {};
    if (plan !== undefined)      data.plan = plan;
    if (maxStores !== undefined)  data.maxStores = parseInt(maxStores);
    if (maxUsers !== undefined)   data.maxUsers = parseInt(maxUsers);
    if (isActive !== undefined) {
      data.isActive = isActive;
      data.deactivatedAt = isActive ? null : new Date();
    }

    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ success: true, data: org });
  } catch (error) {
    next(error);
  }
};

/* POST /api/admin/organizations — create org */
export const createOrganization = async (req, res, next) => {
  try {
    const { name, slug, plan, billingEmail, maxStores, maxUsers } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required' });

    const org = await prisma.organization.create({
      data: {
        name, slug,
        plan: plan || 'trial',
        billingEmail: billingEmail || null,
        maxStores: maxStores ? parseInt(maxStores) : 1,
        maxUsers: maxUsers ? parseInt(maxUsers) : 3,
      },
    });

    res.status(201).json({ success: true, data: org });
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'An organization with this slug already exists' });
    next(error);
  }
};

/* DELETE /api/admin/organizations/:id — soft delete */
export const softDeleteOrganization = async (req, res, next) => {
  try {
    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data: { isActive: false, deactivatedAt: new Date() },
    });
    res.json({ success: true, data: org, message: 'Organization deactivated' });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// STORE MANAGEMENT (cross-org)
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/stores?search=main&page=1&limit=25 */
export const getAllStores = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [stores, total] = await Promise.all([
      prisma.store.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true } },
          _count: { select: { users: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.store.count({ where }),
    ]);

    res.json({ success: true, data: stores, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    next(error);
  }
};

/* POST /api/admin/stores — create store */
export const createStore = async (req, res, next) => {
  try {
    const { name, orgId, address, stationCount } = req.body;
    if (!name || !orgId) return res.status(400).json({ error: 'Name and organization are required' });

    const store = await prisma.store.create({
      data: { name, orgId, address: address || null, stationCount: stationCount ? parseInt(stationCount) : 1 },
    });

    res.status(201).json({ success: true, data: store });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/stores/:id — update store */
export const updateStore = async (req, res, next) => {
  try {
    const { name, address, stationCount, isActive, orgId } = req.body;
    const data = {};
    if (name !== undefined)         data.name = name;
    if (address !== undefined)      data.address = address;
    if (stationCount !== undefined) data.stationCount = parseInt(stationCount);
    if (isActive !== undefined)     data.isActive = isActive;
    if (orgId !== undefined)        data.orgId = orgId;

    const store = await prisma.store.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: store });
  } catch (error) {
    next(error);
  }
};

/* DELETE /api/admin/stores/:id — soft delete */
export const softDeleteStore = async (req, res, next) => {
  try {
    const store = await prisma.store.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ success: true, data: store, message: 'Store deactivated' });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// CMS PAGES
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/cms */
export const getCmsPages = async (req, res, next) => {
  try {
    const pages = await prisma.cmsPage.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json({ success: true, data: pages });
  } catch (error) {
    next(error);
  }
};

/* POST /api/admin/cms */
export const createCmsPage = async (req, res, next) => {
  try {
    const { slug, title, content, metaTitle, metaDesc, published, sortOrder } = req.body;
    const page = await prisma.cmsPage.create({
      data: { slug, title, content: content || '', metaTitle, metaDesc, published: !!published, sortOrder: sortOrder || 0 },
    });
    res.status(201).json({ success: true, data: page });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'A page with this slug already exists.' });
    }
    next(error);
  }
};

/* PUT /api/admin/cms/:id */
export const updateCmsPage = async (req, res, next) => {
  try {
    const { slug, title, content, metaTitle, metaDesc, published, sortOrder } = req.body;
    const page = await prisma.cmsPage.update({
      where: { id: req.params.id },
      data: { slug, title, content, metaTitle, metaDesc, published, sortOrder },
    });
    res.json({ success: true, data: page });
  } catch (error) {
    next(error);
  }
};

/* DELETE /api/admin/cms/:id */
export const deleteCmsPage = async (req, res, next) => {
  try {
    await prisma.cmsPage.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Page deleted' });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// CAREER POSTINGS
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/careers */
export const getCareerPostings = async (req, res, next) => {
  try {
    const careers = await prisma.careerPosting.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: careers });
  } catch (error) {
    next(error);
  }
};

/* POST /api/admin/careers */
export const createCareerPosting = async (req, res, next) => {
  try {
    const { title, department, location, type, description, published } = req.body;
    const career = await prisma.careerPosting.create({
      data: { title, department, location, type, description: description || '', published: !!published },
    });
    res.status(201).json({ success: true, data: career });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/careers/:id */
export const updateCareerPosting = async (req, res, next) => {
  try {
    const { title, department, location, type, description, published } = req.body;
    const career = await prisma.careerPosting.update({
      where: { id: req.params.id },
      data: { title, department, location, type, description, published },
    });
    res.json({ success: true, data: career });
  } catch (error) {
    next(error);
  }
};

/* DELETE /api/admin/careers/:id */
export const deleteCareerPosting = async (req, res, next) => {
  try {
    await prisma.careerPosting.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Career posting deleted' });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// SUPPORT TICKETS
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/tickets?status=open&page=1&limit=25 */
export const getSupportTickets = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};
    if (status) where.status = status;

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.supportTicket.count({ where }),
    ]);

    res.json({ success: true, data: tickets, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/tickets/:id */
export const updateSupportTicket = async (req, res, next) => {
  try {
    const { status, priority, adminNotes } = req.body;
    const ticket = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: { status, priority, adminNotes },
    });
    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
};

/* POST /api/admin/tickets */
export const createSupportTicket = async (req, res, next) => {
  try {
    const { email, name, subject, body, priority = 'normal', orgId, userId } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'email is required' });
    if (!subject?.trim()) return res.status(400).json({ error: 'subject is required' });
    if (!body?.trim()) return res.status(400).json({ error: 'body is required' });

    const ticket = await prisma.supportTicket.create({
      data: {
        email: email.trim(),
        name: name?.trim(),
        subject: subject.trim(),
        body: body.trim(),
        priority,
        orgId: orgId || null,
        userId: userId || null,
        status: 'open',
        responses: [],
      },
    });
    res.status(201).json({ success: true, data: ticket });
  } catch (error) { next(error); }
};

/* DELETE /api/admin/tickets/:id */
export const deleteSupportTicket = async (req, res, next) => {
  try {
    await prisma.supportTicket.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) { next(error); }
};

/* POST /api/admin/tickets/:id/reply */
export const addAdminTicketReply = async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const responses = Array.isArray(ticket.responses) ? [...ticket.responses] : [];
    responses.push({
      by:     req.user?.name || 'Support Team',
      byType: 'admin',
      message: message.trim(),
      date:   new Date().toISOString(),
    });

    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: {
        responses,
        status: ticket.status === 'open' ? 'in_progress' : ticket.status,
      },
    });
    res.json({ success: true, data: updated });
  } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// SYSTEM CONFIG
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/config */
export const getSystemConfig = async (req, res, next) => {
  try {
    const configs = await prisma.systemConfig.findMany({ orderBy: { key: 'asc' } });
    res.json({ success: true, data: configs });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/config */
export const updateSystemConfig = async (req, res, next) => {
  try {
    const { key, value, description } = req.body;
    const config = await prisma.systemConfig.upsert({
      where: { key },
      update: { value, description },
      create: { key, value, description },
    });
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/analytics/dashboard */
export const getAnalyticsDashboard = async (req, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalUsers, totalOrgs, totalStores, totalTransactions, recentUsers, recentOrgs, ticketStats] = await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
      prisma.store.count(),
      prisma.transaction.count().catch(() => 0),
      // User signups by day (last 30 days)
      prisma.user.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: thirtyDaysAgo } },
        _count: true,
      }).catch(() => []),
      // Org signups by day (last 30 days)
      prisma.organization.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: thirtyDaysAgo } },
        _count: true,
      }).catch(() => []),
      // Ticket stats
      prisma.supportTicket.groupBy({
        by: ['status'],
        _count: true,
      }).catch(() => []),
    ]);

    // Aggregate user signups by date
    const userSignupsByDay = {};
    for (const u of recentUsers) {
      const day = new Date(u.createdAt).toISOString().split('T')[0];
      userSignupsByDay[day] = (userSignupsByDay[day] || 0) + u._count;
    }

    // Aggregate org signups by date
    const orgSignupsByDay = {};
    for (const o of recentOrgs) {
      const day = new Date(o.createdAt).toISOString().split('T')[0];
      orgSignupsByDay[day] = (orgSignupsByDay[day] || 0) + o._count;
    }

    // Build chart data (last 30 days)
    const chartData = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      chartData.push({
        date: key,
        users: userSignupsByDay[key] || 0,
        orgs: orgSignupsByDay[key] || 0,
      });
    }

    res.json({
      success: true,
      data: {
        totalUsers, totalOrgs, totalStores, totalTransactions,
        chartData,
        ticketStats: ticketStats.reduce((acc, t) => { acc[t.status] = t._count; return acc; }, {}),
      },
    });
  } catch (error) {
    next(error);
  }
};

/* GET /api/admin/analytics/organizations */
export const getOrgAnalytics = async (req, res, next) => {
  try {
    const orgs = await prisma.organization.findMany({
      include: {
        _count: { select: { users: true, stores: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // For each org, get transaction count
    const enriched = await Promise.all(
      orgs.map(async (org) => {
        const txCount = await prisma.transaction.count({
          where: { store: { orgId: org.id } },
        }).catch(() => 0);
        return { ...org, transactionCount: txCount };
      })
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
};

/* GET /api/admin/analytics/stores */
export const getStorePerformance = async (req, res, next) => {
  try {
    const stores = await prisma.store.findMany({
      include: {
        organization: { select: { name: true } },
        _count: { select: { users: true, customers: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with transaction count per store (transactions are linked via storeId)
    const enriched = await Promise.all(
      stores.map(async (store) => {
        const txCount = await prisma.transaction.count({
          where: { storeId: store.id },
        }).catch(() => 0);
        return {
          ...store,
          transactionCount: txCount,
          stationCount: store.stationCount || 0,
        };
      })
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
};

/* GET /api/admin/analytics/users */
export const getUserActivity = async (req, res, next) => {
  try {
    // Role distribution
    const roleDistribution = await prisma.user.groupBy({
      by: ['role'],
      _count: true,
    });

    // Status distribution
    const statusDistribution = await prisma.user.groupBy({
      by: ['status'],
      _count: true,
    });

    // Recent signups (last 20)
    const recentSignups = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, organization: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // User signup trend (last 12 weeks)
    const twelveWeeksAgo = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000);
    const weeklySignups = await prisma.user.findMany({
      where: { createdAt: { gte: twelveWeeksAgo } },
      select: { createdAt: true },
    });

    const byWeek = {};
    weeklySignups.forEach(u => {
      const d = new Date(u.createdAt);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().split('T')[0];
      byWeek[key] = (byWeek[key] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        roleDistribution: roleDistribution.map(r => ({ role: r.role, count: r._count })),
        statusDistribution: statusDistribution.map(s => ({ status: s.status, count: s._count })),
        recentSignups,
        weeklySignups: Object.entries(byWeek).map(([week, count]) => ({ week, count })).sort((a, b) => a.week.localeCompare(b.week)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// JOB APPLICATIONS (Admin)
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/careers/:id/applications */
export const getJobApplications = async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = { careerPostingId: req.params.id };
    if (status) where.status = status;

    const applications = await prisma.jobApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const posting = await prisma.careerPosting.findUnique({
      where: { id: req.params.id },
      select: { title: true, department: true },
    });

    res.json({ success: true, data: applications, posting });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/applications/:id */
export const updateJobApplication = async (req, res, next) => {
  try {
    const { status, adminNotes } = req.body;
    const application = await prisma.jobApplication.update({
      where: { id: req.params.id },
      data: { status, adminNotes },
    });
    res.json({ success: true, data: application });
  } catch (error) {
    next(error);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — PAYMENT TERMINALS (cross-org)
// ═════════════════════════════════════════════════════════════════════════════

/** List all payment terminals across all orgs (superadmin) */
export const adminListPaymentTerminals = async (req, res) => {
  try {
    const { orgId, storeId, status, page: p = 1, limit: l = 100 } = req.query;
    const where = {};
    if (orgId)  where.orgId   = orgId;
    if (storeId) where.storeId = storeId;
    if (status)  where.status  = status;

    const [total, terminals] = await Promise.all([
      prisma.paymentTerminal.count({ where }),
      prisma.paymentTerminal.findMany({
        where,
        orderBy: [{ orgId: 'asc' }, { createdAt: 'asc' }],
        skip: (Number(p) - 1) * Number(l),
        take: Number(l),
        include: {
          merchant: { select: { orgId: true, site: true, isLive: true, merchId: true } },
          station:  { select: { id: true, name: true } },
        },
      }),
    ]);

    // Attach org name if possible
    const orgIds = [...new Set(terminals.map(t => t.orgId))];
    const orgs   = await prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true },
    });
    const orgMap = Object.fromEntries(orgs.map(o => [o.id, o.name]));

    const data = terminals.map(t => ({ ...t, orgName: orgMap[t.orgId] || t.orgId }));

    return res.json({ success: true, data, total, page: Number(p), pages: Math.ceil(total / Number(l)) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

/** Ping any terminal (superadmin) */
export const adminPingTerminal = async (req, res) => {
  try {
    const { id } = req.params;
    const terminal = await prisma.paymentTerminal.findUnique({ where: { id } });
    if (!terminal) return res.status(404).json({ success: false, error: 'Terminal not found' });

    const { getMerchantConfig, terminalPing } = await import('../services/cardPointeService.js');
    const merchant = await getMerchantConfig(terminal.orgId);
    if (!merchant) return res.status(400).json({ success: false, error: 'Merchant not configured' });

    const result = await terminalPing(merchant, terminal.hsn);

    await prisma.paymentTerminal.update({
      where: { id },
      data: {
        status:     result.connected ? 'active' : 'inactive',
        lastSeenAt: result.connected ? new Date() : terminal.lastSeenAt,
        lastPingMs: result.latencyMs,
      },
    }).catch(() => {});

    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — PAYMENT MERCHANT CREDENTIALS (cross-org, superadmin)
// ═════════════════════════════════════════════════════════════════════════════

export const adminGetPaymentMerchant = async (req, res) => {
  try {
    const { orgId } = req.query;
    if (!orgId) return res.status(400).json({ success: false, error: 'orgId required' });

    const m = await prisma.cardPointeMerchant.findUnique({ where: { orgId } });
    if (!m) return res.json({ success: true, data: null });

    return res.json({
      success: true,
      data: {
        id: m.id, orgId: m.orgId, merchId: m.merchId,
        apiUser: m.apiUser,
        apiPasswordMasked: '••••••••',
        site: m.site, baseUrl: m.baseUrl, isLive: m.isLive,
        createdAt: m.createdAt, updatedAt: m.updatedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const adminSavePaymentMerchant = async (req, res) => {
  try {
    const { orgId, merchId, apiUser, apiPassword, site, baseUrl, isLive } = req.body;
    if (!orgId || !merchId || !apiUser || !apiPassword) {
      return res.status(400).json({ success: false, error: 'orgId, merchId, apiUser, apiPassword required' });
    }

    const { encryptCredential } = await import('../services/cardPointeService.js');
    const encPw = encryptCredential(apiPassword);

    const existing = await prisma.cardPointeMerchant.findUnique({ where: { orgId } });
    const data = { merchId, apiUser, apiPassword: encPw, site: site || 'fts', baseUrl: baseUrl || null, isLive: isLive ?? false };

    const m = existing
      ? await prisma.cardPointeMerchant.update({ where: { orgId }, data })
      : await prisma.cardPointeMerchant.create({ data: { orgId, ...data } });

    return res.json({ success: true, data: { id: m.id, orgId: m.orgId, merchId: m.merchId, apiUser: m.apiUser, site: m.site, isLive: m.isLive } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — PAYMENT SETTINGS (per store, cross-org)
// ═════════════════════════════════════════════════════════════════════════════

export const adminGetPaymentSettings = async (req, res) => {
  try {
    const storeId = req.params.storeId;
    let settings = await prisma.paymentSettings.findUnique({ where: { storeId } });
    if (!settings) {
      return res.json({ success: true, data: { storeId, signatureThreshold: 25.00, tipEnabled: false, tipPresets: [15,18,20,25], surchargeEnabled: false, surchargePercent: null, acceptCreditCards: true, acceptDebitCards: true, acceptAmex: true, acceptContactless: true } });
    }
    return res.json({ success: true, data: settings });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const adminSavePaymentSettings = async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const store = await prisma.store.findFirst({ where: { id: storeId }, select: { orgId: true } });
    if (!store) return res.status(404).json({ success: false, error: 'Store not found' });

    const { signatureThreshold, tipEnabled, tipPresets, surchargeEnabled, surchargePercent, acceptCreditCards, acceptDebitCards, acceptAmex, acceptContactless } = req.body;
    const data = {
      orgId: store.orgId,
      ...(signatureThreshold != null ? { signatureThreshold: Number(signatureThreshold) } : {}),
      ...(tipEnabled != null ? { tipEnabled } : {}),
      ...(tipPresets != null ? { tipPresets } : {}),
      ...(surchargeEnabled != null ? { surchargeEnabled } : {}),
      ...(surchargePercent != null ? { surchargePercent: Number(surchargePercent) } : {}),
      ...(acceptCreditCards != null ? { acceptCreditCards } : {}),
      ...(acceptDebitCards != null ? { acceptDebitCards } : {}),
      ...(acceptAmex != null ? { acceptAmex } : {}),
      ...(acceptContactless != null ? { acceptContactless } : {}),
    };
    const settings = await prisma.paymentSettings.upsert({ where: { storeId }, create: { storeId, ...data }, update: data });
    return res.json({ success: true, data: settings });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — PAYMENT HISTORY (cross-org)
// ═════════════════════════════════════════════════════════════════════════════

export const adminListPaymentHistory = async (req, res) => {
  try {
    const { orgId, storeId, type, status, dateFrom, dateTo, page: p = 1, limit: l = 50 } = req.query;
    const where = {};
    if (orgId)  where.orgId   = orgId;
    if (storeId) where.storeId = storeId;
    if (type)    where.type    = type;
    if (status)  where.status  = status;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo)   where.createdAt.lte = new Date(dateTo);
    }

    const [total, rows] = await Promise.all([
      prisma.paymentTransaction.count({ where }),
      prisma.paymentTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:  (Number(p) - 1) * Number(l),
        take:  Number(l),
        select: {
          id: true, orgId: true, storeId: true,
          retref: true, authCode: true, respCode: true, respText: true,
          lastFour: true, acctType: true, entryMode: true,
          amount: true, capturedAmount: true,
          type: true, status: true,
          signatureCaptured: true,
          invoiceNumber: true, posTransactionId: true, originalRetref: true,
          createdAt: true, updatedAt: true,
          // token intentionally excluded
        },
      }),
    ]);

    // Attach org name
    const orgIds = [...new Set(rows.map(r => r.orgId))];
    const orgs   = await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
    const orgMap = Object.fromEntries(orgs.map(o => [o.id, o.name]));
    const data   = rows.map(r => ({ ...r, orgName: orgMap[r.orgId] || r.orgId }));

    return res.json({ success: true, data, meta: { total, page: Number(p), limit: Number(l), pages: Math.ceil(total / Number(l)) } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — TERMINAL CRUD (cross-org)
// ═════════════════════════════════════════════════════════════════════════════

export const adminCreateTerminal = async (req, res) => {
  try {
    const { orgId, storeId, hsn, name, ipAddress, port, model, stationId } = req.body;
    if (!orgId || !storeId || !hsn) return res.status(400).json({ success: false, error: 'orgId, storeId, hsn required' });

    const merchant = await prisma.cardPointeMerchant.findUnique({ where: { orgId } });
    if (!merchant) return res.status(400).json({ success: false, error: 'Configure CardPointe merchant credentials for this org first' });

    const terminal = await prisma.paymentTerminal.create({
      data: { orgId, storeId, merchantId: merchant.id, hsn, name: name || null, ipAddress: ipAddress || null, port: port || 6443, model: model || null, stationId: stationId || null },
    });
    return res.json({ success: true, data: terminal });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const adminUpdateTerminal = async (req, res) => {
  try {
    const { id } = req.params;
    const terminal = await prisma.paymentTerminal.findUnique({ where: { id } });
    if (!terminal) return res.status(404).json({ success: false, error: 'Terminal not found' });

    const { name, hsn, ipAddress, port, model, stationId, status } = req.body;
    const updated = await prisma.paymentTerminal.update({
      where: { id },
      data: {
        ...(name      != null ? { name }      : {}),
        ...(hsn       != null ? { hsn }       : {}),
        ...(ipAddress != null ? { ipAddress } : {}),
        ...(port      != null ? { port }      : {}),
        ...(model     != null ? { model }     : {}),
        ...(stationId !== undefined ? { stationId: stationId || null } : {}),
        ...(status    != null ? { status }    : {}),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const adminDeleteTerminal = async (req, res) => {
  try {
    const { id } = req.params;
    const terminal = await prisma.paymentTerminal.findUnique({ where: { id } });
    if (!terminal) return res.status(404).json({ success: false, error: 'Terminal not found' });
    await prisma.paymentTerminal.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — BILLING: PLANS
// ═════════════════════════════════════════════════════════════════════════════

/* GET /api/admin/billing/plans */
export const adminListPlans = async (req, res, next) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      include: { addons: true },
      orderBy: { sortOrder: 'asc' },
    });
    // Return { plans, addons } — frontend reads r.data.plans and r.data.addons
    const addons = plans.flatMap(p => p.addons);
    res.json({ plans, addons });
  } catch (err) { next(err); }
};

/* POST /api/admin/billing/plans */
export const adminCreatePlan = async (req, res, next) => {
  try {
    const {
      name, slug, description, basePrice,
      pricePerStore, pricePerRegister,
      includedStores, includedRegisters,
      trialDays, isPublic, isActive, sortOrder,
    } = req.body;
    const plan = await prisma.subscriptionPlan.create({
      data: {
        name, slug, description: description || null,
        basePrice,
        pricePerStore:     pricePerStore     ?? 0,
        pricePerRegister:  pricePerRegister  ?? 0,
        includedStores:    includedStores    ?? 1,
        includedRegisters: includedRegisters ?? 1,
        trialDays:         trialDays         ?? 14,
        isPublic:          isPublic          !== false,
        isActive:          isActive          !== false,
        sortOrder:         sortOrder         ?? 0,
      },
      include: { addons: true },
    });
    res.status(201).json(plan);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'A plan with this slug already exists.' });
    next(err);
  }
};

/* PUT /api/admin/billing/plans/:id */
export const adminUpdatePlan = async (req, res, next) => {
  try {
    const plan = await prisma.subscriptionPlan.update({
      where:   { id: req.params.id },
      data:    req.body,
      include: { addons: true },
    });
    res.json(plan);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'A plan with this slug already exists.' });
    next(err);
  }
};

/* DELETE /api/admin/billing/plans/:id */
export const adminDeletePlan = async (req, res, next) => {
  try {
    await prisma.subscriptionPlan.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/* POST /api/admin/billing/addons */
export const adminCreateAddon = async (req, res, next) => {
  try {
    const addon = await prisma.planAddon.create({ data: req.body });
    res.status(201).json(addon);
  } catch (err) { next(err); }
};

/* PUT /api/admin/billing/addons/:id */
export const adminUpdateAddon = async (req, res, next) => {
  try {
    const addon = await prisma.planAddon.update({
      where: { id: req.params.id },
      data:  req.body,
    });
    res.json(addon);
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — BILLING: SUBSCRIPTIONS
// ═════════════════════════════════════════════════════════════════════════════

/* GET /api/admin/billing/subscriptions */
export const adminListSubscriptions = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const where = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.orgSubscription.findMany({
        where,
        include: {
          plan:         true,
          organization: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
      }),
      prisma.orgSubscription.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

/* GET /api/admin/billing/subscriptions/:orgId */
export const adminGetSubscription = async (req, res, next) => {
  try {
    const sub = await prisma.orgSubscription.findUnique({
      where:   { orgId: req.params.orgId },
      include: {
        plan:         { include: { addons: true } },
        organization: { select: { id: true, name: true } },
        invoices:     { orderBy: { createdAt: 'desc' }, take: 24 },
      },
    });
    res.json(sub || null);
  } catch (err) { next(err); }
};

/* PUT /api/admin/billing/subscriptions/:orgId */
export const adminUpsertSubscription = async (req, res, next) => {
  try {
    const orgId = req.params.orgId;
    const data  = { ...req.body };
    const sub   = await prisma.orgSubscription.upsert({
      where:   { orgId },
      update:  data,
      create:  { orgId, ...data },
      include: { plan: { include: { addons: true } } },
    });
    res.json(sub);
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — BILLING: INVOICES
// ═════════════════════════════════════════════════════════════════════════════

/* GET /api/admin/billing/invoices */
export const adminListInvoices = async (req, res, next) => {
  try {
    const { orgId, status, page = 1, limit = 50 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (orgId) {
      const sub = await prisma.orgSubscription.findUnique({ where: { orgId } });
      if (!sub) return res.json({ data: [], total: 0 });
      where.subscriptionId = sub.id;
    }

    const [data, total] = await Promise.all([
      prisma.billingInvoice.findMany({
        where,
        include: {
          subscription: {
            include: { organization: { select: { id: true, name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
      }),
      prisma.billingInvoice.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

/* POST /api/admin/billing/invoices/:id/write-off */
export const adminWriteOffInvoice = async (req, res, next) => {
  try {
    const invoice = await prisma.billingInvoice.update({
      where: { id: req.params.id },
      data:  {
        status: 'written_off',
        notes:  req.body.notes || 'Written off by admin',
      },
    });
    res.json(invoice);
  } catch (err) { next(err); }
};

/* POST /api/admin/billing/invoices/:id/retry */
export const adminRetryInvoiceNow = async (req, res, next) => {
  try {
    const invoice = await prisma.billingInvoice.findUnique({
      where:   { id: req.params.id },
      include: {
        subscription: {
          include: {
            plan:         { include: { addons: true } },
            organization: true,
          },
        },
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const { chargeSubscription } = await import('../services/billingService.js');
    try {
      const result = await chargeSubscription(
        invoice.subscription,
        Number(invoice.totalAmount),
        invoice.invoiceNumber,
      );
      await prisma.billingInvoice.update({
        where: { id: invoice.id },
        data:  {
          status:        'paid',
          paidAt:        new Date(),
          retref:        result.retref,
          authcode:      result.authcode,
          attempts:      { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });
      await prisma.orgSubscription.update({
        where: { id: invoice.subscription.id },
        data:  { status: 'active', retryCount: 0, lastFailedAt: null, nextRetryAt: null },
      });
      res.json({ ok: true, retref: result.retref });
    } catch (payErr) {
      await prisma.billingInvoice.update({
        where: { id: invoice.id },
        data:  { status: 'failed', attempts: { increment: 1 }, lastAttemptAt: new Date() },
      });
      res.status(402).json({ error: payErr.message });
    }
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — EQUIPMENT: PRODUCTS
// ═════════════════════════════════════════════════════════════════════════════

/* GET /api/admin/billing/equipment/products */
export const adminListEquipmentProducts = async (req, res, next) => {
  try {
    const products = await prisma.equipmentProduct.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(products);
  } catch (err) { next(err); }
};

/* POST /api/admin/billing/equipment/products */
export const adminCreateEquipmentProduct = async (req, res, next) => {
  try {
    const product = await prisma.equipmentProduct.create({ data: req.body });
    res.status(201).json(product);
  } catch (err) { next(err); }
};

/* PUT /api/admin/billing/equipment/products/:id */
export const adminUpdateEquipmentProduct = async (req, res, next) => {
  try {
    const product = await prisma.equipmentProduct.update({
      where: { id: req.params.id },
      data:  req.body,
    });
    res.json(product);
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — EQUIPMENT: ORDERS
// ═════════════════════════════════════════════════════════════════════════════

/* GET /api/admin/billing/equipment/orders */
export const adminListEquipmentOrders = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const where = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.equipmentOrder.findMany({
        where,
        include: { items: { include: { product: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
      }),
      prisma.equipmentOrder.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

/* PUT /api/admin/billing/equipment/orders/:id */
export const adminUpdateEquipmentOrder = async (req, res, next) => {
  try {
    const order = await prisma.equipmentOrder.update({
      where: { id: req.params.id },
      data:  req.body,
    });
    res.json(order);
  } catch (err) { next(err); }
};
