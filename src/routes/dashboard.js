'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const dashboardService = require('../services/dashboardService');

const router = express.Router();

router.use(authenticate);

router.get('/summary', requirePermission('dashboard.view'), asyncHandler(async (req, res) => {
  const [daily, overall] = await Promise.all([
    dashboardService.dailySummary(),
    dashboardService.overallStats()
  ]);
  res.json({ ok: true, daily, overall });
}));

router.get('/audit', requirePermission('audit.view'), asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json({ ok: true, audit: await dashboardService.auditTrail({ limit }) });
}));

router.get('/merchant-settlement', requireRole('merchant', 'analyst', 'admin'), asyncHandler(async (req, res) => {
  const merchantId = req.user.role === 'merchant'
    ? req.user.merchantId
    : (req.query.merchantId ? Number(req.query.merchantId) : null);
  res.json({ ok: true, settlement: await dashboardService.merchantSettlement(merchantId) });
}));

module.exports = router;
