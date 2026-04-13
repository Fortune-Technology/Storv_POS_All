/**
 * Customer auth controller — proxies to POS backend for signup/login/profile.
 * Uses POS Customer table as single source of truth.
 * JWT signing stays here in ecom-backend.
 */

import prisma from '../config/postgres.js';
import { signCustomerToken } from '../middleware/customerAuth.js';
import { posSignup, posLogin, posGetProfile, posUpdateProfile, posChangePassword } from '../services/posCustomerAuthService.js';

export const signup = async (req, res) => {
  try {
    const { name, firstName, lastName, email, phone, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const result = await posSignup(req.orgId, req.storeId, {
      email, password, firstName, lastName, name, phone,
    });

    const customer = result.customer;
    const token = signCustomerToken({
      id: customer.id,
      storeId: customer.storeId,
      email: customer.email,
    });

    res.status(result.claimed ? 200 : 201).json({
      success: true,
      token,
      customer: {
        id: customer.id,
        name: customer.name,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
      },
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error || 'Signup failed';
    res.status(status).json({ error: message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await posLogin(req.orgId, req.storeId, email, password);
    const customer = result.customer;

    const token = signCustomerToken({
      id: customer.id,
      storeId: customer.storeId,
      email: customer.email,
    });

    res.json({
      success: true,
      token,
      customer: {
        id: customer.id,
        name: customer.name,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
      },
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error || 'Login failed';
    res.status(status).json({ error: message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const result = await posGetProfile(req.customer.customerId);
    if (!result?.data) return res.status(404).json({ error: 'Account not found' });

    const c = result.data;

    // Enrich with order stats from ecom database
    const orderStats = await prisma.ecomOrder.aggregate({
      where: { storeId: req.customer.storeId, customerEmail: req.customer.email },
      _count: true,
      _sum: { grandTotal: true },
    });

    res.json({
      success: true,
      data: {
        id: c.id,
        name: c.name,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        addresses: c.addresses,
        loyaltyPoints: c.loyaltyPoints,
        discount: c.discount,
        balance: c.balance,
        orderCount: orderStats._count || 0,
        totalSpent: orderStats._sum?.grandTotal || 0,
        createdAt: c.createdAt,
      },
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error || 'Failed to load profile';
    res.status(status).json({ error: message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, name, phone, addresses } = req.body;
    const result = await posUpdateProfile(req.customer.customerId, {
      firstName, lastName, name, phone, addresses,
    });

    res.json({ success: true, data: result.data });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error || 'Update failed';
    res.status(status).json({ error: message });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const result = await posChangePassword(req.customer.customerId, currentPassword, newPassword);
    res.json(result);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error || 'Password change failed';
    res.status(status).json({ error: message });
  }
};

export const getMyOrders = async (req, res) => {
  try {
    const orders = await prisma.ecomOrder.findMany({
      where: { storeId: req.customer.storeId, customerEmail: req.customer.email },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getOrderDetail = async (req, res) => {
  try {
    const order = await prisma.ecomOrder.findUnique({
      where: { id: req.params.orderId },
    });
    if (!order || order.customerEmail !== req.customer.email) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
