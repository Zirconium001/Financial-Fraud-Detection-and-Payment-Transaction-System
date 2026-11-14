'use strict';

const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { AppError } = require('../utils/errors');

const ROLES = ['customer', 'merchant', 'analyst', 'admin'];
const STAFF_ROLES = ['analyst', 'admin'];

async function listUsers() {
  const [rows] = await pool.query(
    `SELECT user_id, username, email, role, customer_id, merchant_id,
            is_active, last_login, created_at
       FROM users
      ORDER BY user_id`
  );
  return rows;
}

async function listPermissions() {
  const [rows] = await pool.query(
    `SELECT p.permission_key, p.description,
            GROUP_CONCAT(rp.role ORDER BY rp.role SEPARATOR ',') AS roles
       FROM permissions p
       LEFT JOIN role_permissions rp ON rp.permission_key = p.permission_key
      GROUP BY p.permission_key, p.description
      ORDER BY p.permission_key`
  );
  return rows.map((row) => ({
    ...row,
    roles: row.roles ? row.roles.split(',') : []
  }));
}

async function getUser(userId) {
  const [rows] = await pool.query(
    `SELECT user_id, username, email, role, customer_id, merchant_id,
            is_active, last_login, created_at
       FROM users
      WHERE user_id = ?`,
    [userId]
  );
  if (!rows.length) throw new AppError('User not found', 404, 'NOT_FOUND');
  return rows[0];
}

async function createUser({ username, email, password, role }, actorUserId) {
  const uname = String(username || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  const pass = String(password || '');
  const userRole = String(role || '').trim();

  if (uname.length < 3) throw new AppError('Username must be at least 3 characters', 400, 'BAD_REQUEST');
  if (!mail || !mail.includes('@')) throw new AppError('A valid email is required', 400, 'BAD_REQUEST');
  if (pass.length < 6) throw new AppError('Password must be at least 6 characters', 400, 'BAD_REQUEST');
  if (!STAFF_ROLES.includes(userRole)) {
    throw new AppError('Admin can only create analyst or admin accounts', 400, 'BAD_REQUEST');
  }

  const hash = await bcrypt.hash(pass, 10);
  const [result] = await pool.query(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES (?, ?, ?, ?)`,
    [uname, mail, hash, userRole]
  );

  await writeAudit(actorUserId, 'ADMIN_USER_CREATE', {
    user_id: result.insertId,
    username: uname,
    role: userRole
  });

  return getUser(result.insertId);
}

async function updateUserRole(userId, role, actorUserId) {
  const userRole = String(role || '').trim();
  if (!ROLES.includes(userRole)) throw new AppError('Invalid role', 400, 'BAD_REQUEST');
  if (Number(userId) === Number(actorUserId) && userRole !== 'admin') {
    throw new AppError('You cannot change your own admin role', 400, 'BAD_REQUEST');
  }

  const existing = await getUser(userId);
  if (userRole === 'customer' && !existing.customer_id) {
    throw new AppError('Cannot assign customer role to a user without a customer profile', 400, 'BAD_REQUEST');
  }
  if (userRole === 'merchant' && !existing.merchant_id) {
    throw new AppError('Cannot assign merchant role to a user without a merchant profile', 400, 'BAD_REQUEST');
  }

  await pool.query('UPDATE users SET role = ? WHERE user_id = ?', [userRole, userId]);
  await writeAudit(actorUserId, 'ADMIN_USER_ROLE_CHANGE', {
    user_id: Number(userId),
    role: userRole
  });
  return getUser(userId);
}

async function updateUserStatus(userId, isActive, actorUserId) {
  const active = isActive === true || isActive === 1 || isActive === '1' || isActive === 'true';
  if (Number(userId) === Number(actorUserId) && !active) {
    throw new AppError('You cannot deactivate your own account', 400, 'BAD_REQUEST');
  }

  await getUser(userId);
  await pool.query('UPDATE users SET is_active = ? WHERE user_id = ?', [active ? 1 : 0, userId]);
  await writeAudit(actorUserId, 'ADMIN_USER_STATUS_CHANGE', {
    user_id: Number(userId),
    is_active: active
  });
  return getUser(userId);
}

async function writeAudit(actorUserId, action, detail) {
  await pool.query(
    'INSERT INTO audit_log (actor_user_id, action, detail) VALUES (?, ?, ?)',
    [actorUserId, action, JSON.stringify(detail)]
  );
}

module.exports = {
  ROLES,
  listUsers,
  listPermissions,
  createUser,
  updateUserRole,
  updateUserStatus
};
