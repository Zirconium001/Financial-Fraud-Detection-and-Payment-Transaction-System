-- =============================================================================
--  05_rbac.sql  --  Role-Based Access Control at the database layer
-- =============================================================================
--  Demonstrates least-privilege access: each application role can only touch
--  the views/procedures relevant to it. Application-level RBAC (JWT roles) is
--  additionally enforced by the Node backend.
--
--  NOTE: Default-role syntax differs between servers:
--      MariaDB : SET DEFAULT ROLE <role> FOR <user>
--      MySQL 8 : ALTER USER <user> DEFAULT ROLE <role>
--  (MariaDB has no "ALL ... TO" form; MySQL 8 also accepts SET DEFAULT ROLE
--  ... TO ..., but ALTER USER is the form both servers can prepare.)
--
--  phpMyAdmin's SQL analyser does not recognise the SET DEFAULT ROLE statement,
--  so the statements below are built dynamically per server version and issued
--  through PREPARE. That keeps the script error-free when checked/pasted into
--  phpMyAdmin while still executing normally on XAMPP/MariaDB and MySQL 8.
--  The setup script treats this file as optional, so a failure here never
--  blocks the rest of the database build.
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

-- Admin is a superset of Analyst: inherit all analyst read/investigation grants.
GRANT role_analyst TO role_admin;

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

SET @sql = IF(VERSION() LIKE '%MariaDB%',
  'SET DEFAULT ROLE role_customer FOR ''cust_demo''@''%''',
  'ALTER USER ''cust_demo''@''%'' DEFAULT ROLE role_customer');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(VERSION() LIKE '%MariaDB%',
  'SET DEFAULT ROLE role_merchant FOR ''merch_demo''@''%''',
  'ALTER USER ''merch_demo''@''%'' DEFAULT ROLE role_merchant');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(VERSION() LIKE '%MariaDB%',
  'SET DEFAULT ROLE role_analyst FOR ''analyst_demo''@''%''',
  'ALTER USER ''analyst_demo''@''%'' DEFAULT ROLE role_analyst');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(VERSION() LIKE '%MariaDB%',
  'SET DEFAULT ROLE role_admin FOR ''admin_demo''@''%''',
  'ALTER USER ''admin_demo''@''%'' DEFAULT ROLE role_admin');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

FLUSH PRIVILEGES;
