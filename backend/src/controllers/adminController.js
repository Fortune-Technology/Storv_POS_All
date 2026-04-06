/**
 * Admin Controller  —  /api/admin
 *
 * System-level admin endpoints for superadmin users.
 * NOT scoped to any org — these manage ALL users, orgs, content.
 */

import prisma from '../config/postgres.js';

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/dashboard */
export const getDashboardStats = async (req, res, next) => {
  try {
    const [totalUsers, pendingUsers, totalOrgs, activeOrgs, openTickets] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'pending' } }),
      prisma.organization.count(),
      prisma.organization.count({ where: { isActive: true } }),
      prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    ]);

    res.json({
      success: true,
      data: { totalUsers, pendingUsers, totalOrgs, activeOrgs, openTickets },
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

    res.json({ success: true, data: user, message: 'User rejected' });
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
