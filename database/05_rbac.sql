-- =============================================================================
--  05_rbac.sql  --  Role-Based Access Control at the database layer
-- =============================================================================
--  Demonstrates least-privilege access: each application role can only touch
--  the views/procedures relevant to it. Application-level RBAC (JWT roles) is
--  additionally enforced by the Node backend.
--
--  NOTE: CREATE ROLE / CREATE USER syntax and SET DEFAULT ROLE differ slightly
--  between MySQL 8 and MariaDB (XAMPP ships MariaDB). The setup script runs
--  this file with per-statement error tolerance, so any unsupported directive
--  is skipped and the API still enforces role separation in code.
--
--  If run manually in phpMyAdmin, execute the CREATE ROLE / GRANT statements
--  individually and ignore the SET DEFAULT ROLE block on MariaDB.
-- =============================================================================

USE fraud_detection;

-- ---------------------------------------------------------------------------
--  Customer role : see only their own accounts, run self-service money moves.
-- ---------------------------------------------------------------------------
DROP ROLE IF EXISTS role_customer;
CREATE ROLE role_customer;
GRANT SELECT ON fraud_detection.v_customer_accounts TO role_customer;
GRANT SELECT ON fraud_detection.transactions      TO role_customer;
GRANT EXECUTE ON PROCEDURE fraud_detection.sp_deposit  TO role_customer;
GRANT EXECUTE ON PROCEDURE fraud_detection.sp_withdraw TO role_customer;
GRANT EXECUTE ON PROCEDURE fraud_detection.sp_transfer TO role_customer;

-- ---------------------------------------------------------------------------
--  Merchant role : settlement reporting only.
-- ---------------------------------------------------------------------------
DROP ROLE IF EXISTS role_merchant;
CREATE ROLE role_merchant;
GRANT SELECT ON fraud_detection.v_merchant_settlement TO role_merchant;

-- ---------------------------------------------------------------------------
--  Fraud-analyst role : investigation views + reversal capability.
-- ---------------------------------------------------------------------------
DROP ROLE IF EXISTS role_analyst;
CREATE ROLE role_analyst;
GRANT SELECT ON fraud_detection.v_flagged_transactions TO role_analyst;
GRANT SELECT ON fraud_detection.v_transaction_feed     TO role_analyst;
GRANT SELECT ON fraud_detection.v_account_risk         TO role_analyst;
GRANT SELECT ON fraud_detection.v_rule_hit_stats       TO role_analyst;
GRANT SELECT ON fraud_detection.v_fraud_ring_devices   TO role_analyst;
GRANT SELECT ON fraud_detection.v_shared_ip_ring       TO role_analyst;
GRANT EXECUTE ON PROCEDURE fraud_detection.sp_reverse_transaction TO role_analyst;

-- ---------------------------------------------------------------------------
--  Admin role : full reporting + audit + risk recomputation.
-- ---------------------------------------------------------------------------
DROP ROLE IF EXISTS role_admin;
CREATE ROLE role_admin;
GRANT SELECT ON fraud_detection.v_daily_transaction_summary TO role_admin;
GRANT SELECT ON fraud_detection.v_recent_audit              TO role_admin;
GRANT EXECUTE ON PROCEDURE fraud_detection.sp_recompute_all_risk TO role_admin;
GRANT EXECUTE ON PROCEDURE fraud_detection.sp_block_account TO role_admin;
GRANT EXECUTE ON PROCEDURE fraud_detection.sp_unblock_account TO role_admin;
GRANT EXECUTE ON PROCEDURE fraud_detection.sp_block_suspicious_accounts TO role_admin;

-- ---------------------------------------------------------------------------
--  Demo login accounts (password here is illustrative only).
-- ---------------------------------------------------------------------------
CREATE USER IF NOT EXISTS 'cust_demo'@'%'     IDENTIFIED BY 'Cust@12345';
CREATE USER IF NOT EXISTS 'merch_demo'@'%'    IDENTIFIED BY 'Merch@12345';
CREATE USER IF NOT EXISTS 'analyst_demo'@'%'  IDENTIFIED BY 'Analyst@12345';
CREATE USER IF NOT EXISTS 'admin_demo'@'%'    IDENTIFIED BY 'Admin@12345';

GRANT role_customer TO 'cust_demo'@'%';
GRANT role_merchant TO 'merch_demo'@'%';
GRANT role_analyst  TO 'analyst_demo'@'%';
GRANT role_admin    TO 'admin_demo'@'%';

SET DEFAULT ROLE ALL TO 'cust_demo'@'%';
SET DEFAULT ROLE ALL TO 'merch_demo'@'%';
SET DEFAULT ROLE ALL TO 'analyst_demo'@'%';
SET DEFAULT ROLE ALL TO 'admin_demo'@'%';

FLUSH PRIVILEGES;
