-- =============================================================================
--  04_views.sql  --  Role-based views, reporting, and relationship queries
-- =============================================================================

USE fraud_detection;

DROP VIEW IF EXISTS v_customer_accounts;
DROP VIEW IF EXISTS v_transaction_feed;
DROP VIEW IF EXISTS v_flagged_transactions;
DROP VIEW IF EXISTS v_daily_transaction_summary;
DROP VIEW IF EXISTS v_account_risk;
DROP VIEW IF EXISTS v_rule_hit_stats;
DROP VIEW IF EXISTS v_merchant_settlement;
DROP VIEW IF EXISTS v_shared_ip_ring;
DROP VIEW IF EXISTS v_recent_audit;

-- ----------------------------------------------------------------------------
--  CUSTOMER self-service view : only their own accounts.
-- ----------------------------------------------------------------------------
CREATE VIEW v_customer_accounts AS
SELECT
  c.customer_id,
  c.full_name,
  a.account_id,
  a.account_number,
  a.account_type,
  a.currency,
  a.balance,
  a.status        AS account_status,
  c.risk_score,
  c.kyc_status
FROM customers c
JOIN accounts a ON a.customer_id = c.customer_id;

-- ----------------------------------------------------------------------------
--  Full transaction feed with resolved entities (analyst / admin).
-- ----------------------------------------------------------------------------
CREATE VIEW v_transaction_feed AS
SELECT
  t.txn_id,
  t.txn_ref,
  t.created_at,
  t.txn_type,
  t.amount,
  t.currency,
  t.status,
  t.risk_score,
  a.account_number,
  c.customer_id,
  c.full_name        AS customer_name,
  m.name             AS merchant_name,
  d.device_fingerprint,
  t.ip_address
FROM transactions t
JOIN accounts  a ON a.account_id = t.account_id
JOIN customers c ON c.customer_id = a.customer_id
LEFT JOIN merchants m ON m.merchant_id = t.merchant_id
LEFT JOIN devices   d ON d.device_id   = t.device_id;

-- ----------------------------------------------------------------------------
--  Flagged / quarantined transactions (fraud-analyst work queue).
-- ----------------------------------------------------------------------------
CREATE VIEW v_flagged_transactions AS
SELECT *
FROM v_transaction_feed
WHERE status IN ('flagged','quarantined')
ORDER BY risk_score DESC, created_at DESC;

-- ----------------------------------------------------------------------------
--  Daily dashboard rollup.
-- ----------------------------------------------------------------------------
CREATE VIEW v_daily_transaction_summary AS
SELECT
  DATE(created_at)                                        AS txn_date,
  COUNT(*)                                                AS txn_count,
  SUM(amount)                                             AS total_amount,
  SUM(status IN ('flagged','quarantined'))                AS flagged_count,
  ROUND(100 * SUM(status IN ('flagged','quarantined')) / COUNT(*), 2) AS flagged_ratio_pct,
  ROUND(AVG(risk_score), 2)                               AS avg_risk_score
FROM transactions
GROUP BY DATE(created_at);

-- ----------------------------------------------------------------------------
--  Account risk ranking (top-risk accounts).
-- ----------------------------------------------------------------------------
CREATE VIEW v_account_risk AS
SELECT
  a.account_id,
  a.account_number,
  a.status              AS account_status,
  a.balance,
  c.customer_id,
  c.full_name,
  c.is_blocked,
  c.risk_score            AS customer_risk,
  COUNT(t.txn_id)         AS total_txns,
  SUM(t.status IN ('flagged','quarantined')) AS flagged_txns,
  ROUND(COALESCE(AVG(t.risk_score), 0), 2)   AS avg_txn_risk
FROM accounts a
JOIN customers c ON c.customer_id = a.customer_id
LEFT JOIN transactions t ON t.account_id = a.account_id
GROUP BY a.account_id, a.account_number, a.status, a.balance,
         c.customer_id, c.full_name, c.is_blocked, c.risk_score
ORDER BY customer_risk DESC, avg_txn_risk DESC;

-- ----------------------------------------------------------------------------
--  Rule-hit statistics (which rules fire most).
-- ----------------------------------------------------------------------------
CREATE VIEW v_rule_hit_stats AS
SELECT
  r.rule_id,
  r.code,
  r.name,
  r.severity,
  COUNT(h.hit_id)                          AS evaluations,
  SUM(h.matched)                           AS matches,
  ROUND(SUM(h.score_contribution), 2)      AS total_score
FROM fraud_rules r
LEFT JOIN fraud_rule_hits h ON h.rule_id = r.rule_id
GROUP BY r.rule_id, r.code, r.name, r.severity
ORDER BY matches DESC;

-- ----------------------------------------------------------------------------
--  Merchant settlement view.
-- ----------------------------------------------------------------------------
CREATE VIEW v_merchant_settlement AS
SELECT
  m.merchant_id,
  m.name,
  m.category,
  m.risk_level,
  COUNT(t.txn_id)                     AS txn_count,
  COALESCE(SUM(t.amount), 0)          AS gross_amount,
  SUM(t.status IN ('flagged','quarantined')) AS flagged_count
FROM merchants m
LEFT JOIN transactions t ON t.merchant_id = m.merchant_id
GROUP BY m.merchant_id, m.name, m.category, m.risk_level;

-- ----------------------------------------------------------------------------
--  Relationship query: IP addresses shared by more than one customer
--  (fraud-ring signal -- self-join / aggregation over the graph).
-- ----------------------------------------------------------------------------
CREATE VIEW v_shared_ip_ring AS
SELECT
  t.ip_address,
  COUNT(DISTINCT a.customer_id)   AS distinct_customers,
  COUNT(DISTINCT t.account_id)    AS accounts_linked,
  GROUP_CONCAT(DISTINCT a.account_number ORDER BY a.account_number SEPARATOR ', ') AS account_numbers
FROM transactions t
JOIN accounts a ON a.account_id = t.account_id
WHERE t.ip_address IS NOT NULL
GROUP BY t.ip_address
HAVING distinct_customers > 1
ORDER BY distinct_customers DESC, accounts_linked DESC;

-- ----------------------------------------------------------------------------
--  Recent audit trail (reporter / auditor).
-- ----------------------------------------------------------------------------
CREATE VIEW v_recent_audit AS
SELECT
  l.log_id,
  l.created_at,
  l.action,
  l.account_id,
  a.account_number,
  l.txn_id,
  l.old_balance,
  l.new_balance,
  l.detail
FROM audit_log l
LEFT JOIN accounts a ON a.account_id = l.account_id
ORDER BY l.log_id DESC;
