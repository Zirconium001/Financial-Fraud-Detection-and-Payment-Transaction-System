'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requirePermission } = require('../middleware/auth');
const { AppError } = require('../utils/errors');
const fraudService = require('../services/fraudService');

const router = express.Router();

router.use(authenticate);

router.get('/flagged', requirePermission('fraud.queue.view'), asyncHandler(async (req, res) => {
  const rows = await fraudService.listFlagged({
    status: req.query.status,
    limit: req.query.limit ? Number(req.query.limit) : undefined
  });
  res.json({ ok: true, transactions: rows });
}));

router.get('/rules', requirePermission('fraud.rules.view'), asyncHandler(async (req, res) => {
  const [rules, stats] = await Promise.all([
    fraudService.listRules(),
    fraudService.ruleHitStats()
  ]);
  res.json({ ok: true, rules, stats });
}));

router.patch('/rules/:id', requirePermission('fraud.rules.edit'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid rule id');
  const rule = await fraudService.updateRule(id, req.body || {}, req.user.userId);
  res.json({ ok: true, rule });
}));

router.get('/rings/ips', requirePermission('fraud.rings.view'), asyncHandler(async (req, res) => {
  res.json({ ok: true, rings: await fraudService.ipRings() });
}));

router.get('/top-risk', requirePermission('fraud.risk.view'), asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json({ ok: true, accounts: await fraudService.topRiskAccounts({ limit }) });
}));

router.get('/blacklist', requirePermission('fraud.blacklist.view'), asyncHandler(async (req, res) => {
  res.json({ ok: true, entries: await fraudService.listBlacklist() });
}));

router.post('/blacklist', requirePermission('fraud.blacklist.edit'), asyncHandler(async (req, res) => {
  const { entityType, entityValue, reason, severity } = req.body || {};
  if (!entityType || !entityValue) throw new AppError('entityType and entityValue are required');
  const result = await fraudService.addBlacklist({
    entityType,
    entityValue,
    reason,
    severity,
    actorUserId: req.user.userId
  });
  res.status(201).json({ ok: true, ...result });
}));

router.delete('/blacklist/:id', requirePermission('fraud.blacklist.edit'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid blacklist id');
  res.json({ ok: true, ...(await fraudService.deleteBlacklist(id, req.user.userId)) });
}));

router.post('/transactions/:id/reverse', requirePermission('fraud.txn.reverse'), asyncHandler(async (req, res) => {
  const result = await fraudService.reverseTransaction(Number(req.params.id), req.user.userId);
  res.json({ ok: true, transaction: result });
}));

router.post('/recompute-risk', requirePermission('fraud.risk.recompute'), asyncHandler(async (req, res) => {
  res.json(await fraudService.recomputeRisk(req.user.userId));
}));

router.post('/block-suspicious', requirePermission('fraud.account.block'), asyncHandler(async (req, res) => {
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

router.post('/accounts/:id/block', requirePermission('fraud.account.block'), asyncHandler(async (req, res) => {
  const account = await fraudService.blockAccount(
    parseAccountId(req.params.id),
    req.user.userId
  );
  res.json({ ok: true, account });
}));

router.post('/accounts/:id/unblock', requirePermission('fraud.account.block'), asyncHandler(async (req, res) => {
  const account = await fraudService.unblockAccount(
    parseAccountId(req.params.id),
    req.user.userId
  );
  res.json({ ok: true, account });
}));

module.exports = router;
