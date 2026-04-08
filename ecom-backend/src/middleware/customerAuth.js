/**
 * Customer authentication middleware for the storefront.
 * Validates customer JWT (separate from POS portal JWT).
 */

import jwt from 'jsonwebtoken';

const CUSTOMER_JWT_SECRET = process.env.JWT_SECRET + '-customer';

export function signCustomerToken(customer) {
  return jwt.sign(
    { customerId: customer.id, storeId: customer.storeId, email: customer.email },
    CUSTOMER_JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export const protectCustomer = (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ error: 'Please sign in to continue' });
  }
  try {
    const decoded = jwt.verify(token, CUSTOMER_JWT_SECRET);
    req.customer = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired — please sign in again' });
  }
};

/**
 * Optional auth — sets req.customer if token present, otherwise continues.
 */
export const optionalCustomer = (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (token) {
    try {
      req.customer = jwt.verify(token, CUSTOMER_JWT_SECRET);
    } catch {}
  }
  next();
};
