/**
 * Customer auth controller — signup, login, profile, addresses, order history.
 */

import bcrypt from 'bcryptjs';
import prisma from '../config/postgres.js';
import { signCustomerToken } from '../middleware/customerAuth.js';

export const signup = async (req, res) => {
  try {
    const { name, firstName, lastName, email, phone, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await prisma.ecomCustomer.findUnique({
      where: { storeId_email: { storeId: req.storeId, email: email.toLowerCase() } },
    });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const fName = firstName || (name ? name.split(' ')[0] : '');
    const lName = lastName || (name ? name.split(' ').slice(1).join(' ') : '');

    const passwordHash = await bcrypt.hash(password, 10);
    const customer = await prisma.ecomCustomer.create({
      data: {
        orgId: req.orgId,
        storeId: req.storeId,
        name: name || `${fName} ${lName}`.trim(),
        firstName: fName,
        lastName: lName,
        email: email.toLowerCase(),
        phone: phone || null,
        passwordHash,
      },
    });

    const token = signCustomerToken(customer);
    res.status(201).json({
      success: true,
      token,
      customer: { id: customer.id, name: customer.name, firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const customer = await prisma.ecomCustomer.findUnique({
      where: { storeId_email: { storeId: req.storeId, email: email.toLowerCase() } },
    });
    if (!customer || !customer.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, customer.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signCustomerToken(customer);
    res.json({
      success: true,
      token,
      customer: { id: customer.id, name: customer.name, firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const customer = await prisma.ecomCustomer.findUnique({
      where: { id: req.customer.customerId },
      select: { id: true, name: true, firstName: true, lastName: true, email: true, phone: true, addresses: true, orderCount: true, totalSpent: true, createdAt: true },
    });
    if (!customer) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true, data: customer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, name, phone, addresses } = req.body;
    const data = {};
    if (firstName !== undefined) data.firstName = firstName;
    if (lastName !== undefined) data.lastName = lastName;
    if (firstName !== undefined || lastName !== undefined) {
      data.name = `${firstName || ''} ${lastName || ''}`.trim();
    }
    if (name !== undefined && !firstName && !lastName) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (addresses !== undefined) data.addresses = addresses;

    const customer = await prisma.ecomCustomer.update({
      where: { id: req.customer.customerId },
      data,
      select: { id: true, name: true, firstName: true, lastName: true, email: true, phone: true, addresses: true },
    });
    res.json({ success: true, data: customer });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
