'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requirePermission } = require('../middleware/auth');
const { AppError } = require('../utils/errors');
const adminService = require('../services/adminService');

const router = express.Router();

router.use(authenticate);

function parseUserId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid user id');
  return id;
}

router.get('/users', requirePermission('admin.users.view'), asyncHandler(async (req, res) => {
  res.json({ ok: true, users: await adminService.listUsers() });
}));

router.get('/permissions', requirePermission('admin.users.view'), asyncHandler(async (req, res) => {
  res.json({ ok: true, permissions: await adminService.listPermissions() });
}));

router.post('/users', requirePermission('admin.users.manage'), asyncHandler(async (req, res) => {
  const { username, email, password, role } = req.body || {};
  const user = await adminService.createUser(
    { username, email, password, role },
    req.user.userId
  );
  res.status(201).json({ ok: true, user });
}));

router.patch('/users/:id/role', requirePermission('admin.users.manage'), asyncHandler(async (req, res) => {
  const user = await adminService.updateUserRole(
    parseUserId(req.params.id),
    (req.body || {}).role,
    req.user.userId
  );
  res.json({ ok: true, user });
}));

router.patch('/users/:id/status', requirePermission('admin.users.manage'), asyncHandler(async (req, res) => {
  const { isActive } = req.body || {};
  if (isActive === undefined || isActive === null) {
    throw new AppError('isActive is required');
  }
  const user = await adminService.updateUserStatus(
    parseUserId(req.params.id),
    isActive,
    req.user.userId
  );
  res.json({ ok: true, user });
}));

module.exports = router;
