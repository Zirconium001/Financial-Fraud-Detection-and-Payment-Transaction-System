'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const { AppError } = require('../utils/errors');
const fraudService = require('../services/fraudService');

const router = express.Router();

router.use(authenticate, requireRole('analyst', 'admin'));

router.get('/flagged', asyncHandler(async (req, res) => {
  const rows = await fraudService.listFlagged({
    status: req.query.status,
    limit: req.query.limit ? Number(req.query.limit) : undefined
  });
  res.json({ ok: true, transactions: rows });
}));

router.get('/rules', asyncHandler(async (req, res) => {
  const [rules, stats] = await Promise.all([
    fraudService.listRules(),
    fraudService.ruleHitStats()
  ]);
  res.json({ ok: true, rules, stats });
}));

router.get('/rings/devices', asyncHandler(async (req, res) => {
  res.json({ ok: true, rings: await fraudService.deviceRings() });
}));

router.get('/rings/ips', asyncHandler(async (req, res) => {
  res.json({ ok: true, rings: await fraudService.ipRings() });
}));

router.get('/top-risk', asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json({ ok: true, accounts: await fraudService.topRiskAccounts({ limit }) });
}));

router.get('/blacklist', asyncHandler(async (req, res) => {
  res.json({ ok: true, entries: await fraudService.listBlacklist() });
}));

router.post('/blacklist', requireRole('admin'), asyncHandler(async (req, res) => {
  const { entityType, entityValue, reason, severity } = req.body || {};
  if (!entityType || !entityValue) throw new AppError('entityType and entityValue are required');
  const result = await fraudService.addBlacklist({ entityType, entityValue, reason, severity });
  res.status(201).json({ ok: true, ...result });
}));

router.post('/transactions/:id/reverse', asyncHandler(async (req, res) => {
  const result = await fraudService.reverseTransaction(Number(req.params.id), req.user.userId);
  res.json({ ok: true, transaction: result });
}));

router.post('/recompute-risk', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await fraudService.recomputeRisk());
}));

router.post('/block-suspicious', requireRole('admin'), asyncHandler(async (req, res) => {
  const { threshold } = req.body || {};
  const result = await fraudService.blockSuspicious({
    threshold,
    actorUserId: req.user.userId
  });
  res.json({ ok: true, ...result });
}));

function parseAccountId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid account id');
  return id;
}

router.post('/accounts/:id/block', requireRole('admin'), asyncHandler(async (req, res) => {
  const account = await fraudService.blockAccount(
    parseAccountId(req.params.id),
    req.user.userId
  );
  res.json({ ok: true, account });
}));

router.post('/accounts/:id/unblock', requireRole('admin'), asyncHandler(async (req, res) => {
  const account = await fraudService.unblockAccount(
    parseAccountId(req.params.id),
    req.user.userId
  );
  res.json({ ok: true, account });
}));

module.exports = router;
