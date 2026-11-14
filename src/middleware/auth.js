'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { pool } = require('../config/db');
const { AppError } = require('../utils/errors');
const permissionsService = require('../services/permissionsService');

/**
 * Verify the Bearer JWT, confirm the account is still active, and refresh the
 * role from the database so deactivation / role changes take effect at once.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError('Missing or malformed Authorization header', 401, 'UNAUTHORIZED'));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    return next(new AppError('Invalid or expired token', 401, 'UNAUTHORIZED'));
  }

  try {
    const [rows] = await pool.query(
      'SELECT role, is_active FROM users WHERE user_id = ?',
      [decoded.userId]
    );
    if (!rows.length || !rows[0].is_active) {
      return next(new AppError('Account is inactive', 401, 'UNAUTHORIZED'));
    }
    req.user = { ...decoded, role: rows[0].role };
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Guard a route to one or more roles. Must be used after authenticate.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Not authenticated', 401, 'UNAUTHORIZED'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions for this action', 403, 'FORBIDDEN'));
    }
    return next();
  };
}

/**
 * Guard a route to one or more permissions (DB-backed role -> permission map).
 * Must be used after authenticate.
 */
function requirePermission(...keys) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(new AppError('Not authenticated', 401, 'UNAUTHORIZED'));
      }

      const granted = await permissionsService.forRole(req.user.role);
      const missing = keys.filter((key) => !granted.has(key));
      if (missing.length) {
        return next(new AppError('Insufficient permissions for this action', 403, 'FORBIDDEN'));
      }

      req.permissions = granted;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

module.exports = { authenticate, requireRole, requirePermission, signToken };
