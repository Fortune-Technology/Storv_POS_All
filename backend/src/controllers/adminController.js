/**
 * Admin Controller  —  /api/admin
 *
 * System-level admin endpoints for superadmin users.
 * NOT scoped to any org — these manage ALL users, orgs, content.
 */

import prisma from '../config/postgres.js';
import bcrypt from 'bcryptjs';
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

/* POST /api/admin/users — create user */
export const createUser = async (req, res, next) => {
  try {
    const { name, email, phone, role, orgId, status } = req.body;
    if (!name || !email || !orgId) return res.status(400).json({ error: 'Name, email, and organization are required' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'A user with this email already exists' });

    const tempPassword = await bcrypt.hash('Temp@1234', 12);
    const user = await prisma.user.create({
      data: { name, email, phone: phone || null, password: tempPassword, role: role || 'staff', orgId, status: status || 'active' },
      select: { id: true, name: true, email: true, role: true, status: true, orgId: true, createdAt: true },
    });

    res.status(201).json({ success: true, data: user });
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
