'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, signToken } = require('../middleware/auth');
const authService = require('../services/authService');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'username and password are required' } });
  }

  const user = await authService.login(username, password);
  const token = signToken({
    userId: user.userId,
    role: user.role,
    customerId: user.customerId,
    merchantId: user.merchantId,
    username: user.username
  });

  res.json({ ok: true, token, user });
}));

router.post('/register', asyncHandler(async (req, res) => {
  const { username, email, password, fullName, phone, accountType } = req.body || {};
  const user = await authService.register({ username, email, password, fullName, phone, accountType });
  const token = signToken({
    userId: user.userId,
    role: user.role,
    customerId: user.customerId,
    merchantId: user.merchantId,
    username: user.username
  });
  res.status(201).json({ ok: true, token, user });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const profile = await authService.getProfile(req.user.userId);
  res.json({ ok: true, user: profile });
}));

module.exports = router;
