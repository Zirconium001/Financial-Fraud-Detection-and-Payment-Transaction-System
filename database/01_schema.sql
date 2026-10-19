-- =============================================================================
--  Financial Fraud Detection & Payment Transaction System
--  01_schema.sql  --  Normalized relational schema (3NF/BCNF)
-- =============================================================================
--  Entities (12): customers, users, accounts, cards, merchants, devices,
--  transactions, fraud_rules, fraud_rule_hits, blacklist, audit_log,
--  account_devices.
--
--  Design notes
--  ------------
--  * Surrogate BIGINT AUTO_INCREMENT keys everywhere; business keys
--    (account_number, card_number, txn_ref, device_fingerprint) are UNIQUE.
--  * Money stored as DECIMAL(15,2) -- never FLOAT -- to avoid rounding drift.
--  * `accounts.version` column supports OPTIMISTIC locking; SELECT ... FOR
--    UPDATE provides PESSIMISTIC row locks inside stored procedures.
--  * Append-only tables (audit_log, fraud_rule_hits) are written only by
--    triggers/procedures -- never UPDATEd by the application.
--  * All multi-entity attributes are 3NF: no transitive dependencies.
-- =============================================================================

DROP DATABASE IF EXISTS fraud_detection;
CREATE DATABASE fraud_detection
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE fraud_detection;

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- customers
-- -----------------------------------------------------------------------------
CREATE TABLE customers (
  customer_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name       VARCHAR(120)    NOT NULL,
  email           VARCHAR(160)    NOT NULL,
  phone           VARCHAR(30)     NULL,
  national_id     VARCHAR(40)     NULL,
  date_of_birth   DATE            NULL,
  address_line    VARCHAR(180)    NULL,
  city            VARCHAR(80)     NULL,
  country         CHAR(2)         NULL,
  kyc_status      ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  risk_score      DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  is_blocked      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id),
  UNIQUE KEY uq_customers_email (email),
  UNIQUE KEY uq_customers_national_id (national_id),
  KEY idx_customers_risk (risk_score),
  CONSTRAINT chk_customers_risk CHECK (risk_score BETWEEN 0 AND 100)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- users  (application identities for RBAC: customer / merchant / analyst / admin)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  user_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(60)     NOT NULL,
  email         VARCHAR(160)    NOT NULL,
  password_hash VARCHAR(255)    NOT NULL,
  role          ENUM('customer','merchant','analyst','admin') NOT NULL,
  customer_id   BIGINT UNSIGNED NULL,
  merchant_id   BIGINT UNSIGNED NULL,
  is_active     TINYINT(1)      NOT NULL DEFAULT 1,
  last_login    TIMESTAMP       NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- accounts
-- -----------------------------------------------------------------------------
CREATE TABLE accounts (
  account_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id    BIGINT UNSIGNED NOT NULL,
  account_number VARCHAR(24)     NOT NULL,
  account_type   ENUM('savings','current','credit','wallet') NOT NULL DEFAULT 'savings',
  currency       CHAR(3)         NOT NULL DEFAULT 'USD',
  balance        DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  status         ENUM('active','frozen','closed') NOT NULL DEFAULT 'active',
  version        INT UNSIGNED    NOT NULL DEFAULT 0,
  opened_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id),
  UNIQUE KEY uq_accounts_number (account_number),
  KEY idx_accounts_customer (customer_id),
  KEY idx_accounts_status (status),
  CONSTRAINT fk_accounts_customer
    FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_accounts_balance CHECK (balance >= 0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- cards
-- -----------------------------------------------------------------------------
CREATE TABLE cards (
  card_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id     BIGINT UNSIGNED NOT NULL,
  card_number    VARCHAR(24)     NOT NULL,   -- masked PAN, e.g. 4111********1234
  card_type      ENUM('debit','credit') NOT NULL DEFAULT 'debit',
  network        ENUM('visa','mastercard','amex','other') NOT NULL DEFAULT 'visa',
  expiry_date    DATE            NOT NULL,
  status         ENUM('active','blocked','expired') NOT NULL DEFAULT 'active',
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (card_id),
  UNIQUE KEY uq_cards_number (card_number),
  KEY idx_cards_account (account_id),
  CONSTRAINT fk_cards_account
    FOREIGN KEY (account_id) REFERENCES accounts (account_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- merchants
-- -----------------------------------------------------------------------------
CREATE TABLE merchants (
  merchant_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(140)    NOT NULL,
  category        VARCHAR(60)     NULL,
  country         CHAR(2)         NULL,
  city            VARCHAR(80)     NULL,
  latitude        DECIMAL(9,6)    NULL,
  longitude       DECIMAL(9,6)    NULL,
  risk_level      ENUM('low','medium','high') NOT NULL DEFAULT 'low',
  is_blacklisted  TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (merchant_id),
  UNIQUE KEY uq_merchants_name (name),
  KEY idx_merchants_risk (risk_level)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- devices  (device fingerprint reused across customers -> fraud rings)
-- -----------------------------------------------------------------------------
CREATE TABLE devices (
  device_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_fingerprint VARCHAR(128)  NOT NULL,
  os                 VARCHAR(60)   NULL,
  browser            VARCHAR(60)   NULL,
  last_ip            VARCHAR(45)   NULL,
  first_seen         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id),
  UNIQUE KEY uq_devices_fingerprint (device_fingerprint),
  KEY idx_devices_ip (last_ip)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- account_devices  (M:N link: which devices have been used on which account)
-- -----------------------------------------------------------------------------
CREATE TABLE account_devices (
  account_id  BIGINT UNSIGNED NOT NULL,
  device_id   BIGINT UNSIGNED NOT NULL,
  first_used  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  times_used  INT UNSIGNED    NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, device_id),
  KEY idx_account_devices_device (device_id),
  CONSTRAINT fk_ad_account
    FOREIGN KEY (account_id) REFERENCES accounts (account_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ad_device
    FOREIGN KEY (device_id) REFERENCES devices (device_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- transactions
-- -----------------------------------------------------------------------------
CREATE TABLE transactions (
  txn_id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  txn_ref               VARCHAR(36)     NOT NULL,
  account_id            BIGINT UNSIGNED NOT NULL,
  txn_type              ENUM('deposit','withdrawal','transfer_out','transfer_in','payment') NOT NULL,
  amount                DECIMAL(15,2)   NOT NULL,
  currency              CHAR(3)         NOT NULL DEFAULT 'USD',
  counterparty_account  BIGINT UNSIGNED NULL,
  merchant_id           BIGINT UNSIGNED NULL,
  device_id             BIGINT UNSIGNED NULL,
  initiated_by          BIGINT UNSIGNED NULL,
  ip_address            VARCHAR(45)     NULL,
  latitude              DECIMAL(9,6)    NULL,
  longitude             DECIMAL(9,6)    NULL,
  status                ENUM('pending','completed','flagged','quarantined','reversed','failed')
                          NOT NULL DEFAULT 'pending',
  risk_score            DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  description           VARCHAR(255)    NULL,
  created_at             TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (txn_id),
  UNIQUE KEY uq_transactions_ref (txn_ref),
  KEY idx_txn_account_time (account_id, created_at),
  KEY idx_txn_status (status),
  KEY idx_txn_device (device_id),
  KEY idx_txn_merchant (merchant_id),
  KEY idx_txn_actor (initiated_by),
  KEY idx_txn_created (created_at),
  CONSTRAINT fk_txn_account
    FOREIGN KEY (account_id) REFERENCES accounts (account_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_txn_counterparty
    FOREIGN KEY (counterparty_account) REFERENCES accounts (account_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_txn_merchant
    FOREIGN KEY (merchant_id) REFERENCES merchants (merchant_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_txn_device
    FOREIGN KEY (device_id) REFERENCES devices (device_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_txn_actor
    FOREIGN KEY (initiated_by) REFERENCES users (user_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_txn_amount CHECK (amount > 0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- fraud_rules  (data-driven rule engine configuration)
-- -----------------------------------------------------------------------------
CREATE TABLE fraud_rules (
  rule_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(40)     NOT NULL,      -- e.g. VELOCITY_TXN
  name           VARCHAR(120)    NOT NULL,
  description    VARCHAR(255)    NULL,
  rule_type      ENUM('velocity','threshold','geo','device','blacklist','structuring','custom')
                   NOT NULL,
  metric         VARCHAR(60)     NULL,          -- what the rule measures
  threshold      DECIMAL(15,2)   NOT NULL DEFAULT 0,
  window_seconds INT UNSIGNED    NOT NULL DEFAULT 0,
  severity       ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  weight         DECIMAL(5,2)    NOT NULL DEFAULT 10.00,
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rule_id),
  UNIQUE KEY uq_fraud_rules_code (code)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- fraud_rule_hits  (immutable audit trail of every rule evaluation)
-- -----------------------------------------------------------------------------
CREATE TABLE fraud_rule_hits (
  hit_id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  txn_id            BIGINT UNSIGNED NOT NULL,
  rule_id           BIGINT UNSIGNED NOT NULL,
  matched           TINYINT(1)      NOT NULL,
  score_contribution DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
  details           JSON            NULL,
  evaluated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hit_id),
  KEY idx_hits_txn (txn_id),
  KEY idx_hits_rule (rule_id),
  CONSTRAINT fk_hits_txn
    FOREIGN KEY (txn_id) REFERENCES transactions (txn_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_hits_rule
    FOREIGN KEY (rule_id) REFERENCES fraud_rules (rule_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- blacklist  (IPs, devices, merchants, accounts)
-- -----------------------------------------------------------------------------
CREATE TABLE blacklist (
  blacklist_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type  ENUM('ip','device','merchant','account','country') NOT NULL,
  entity_value VARCHAR(160)    NOT NULL,
  reason       VARCHAR(255)    NULL,
  severity     ENUM('low','medium','high','critical') NOT NULL DEFAULT 'high',
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blacklist_id),
  UNIQUE KEY uq_blacklist (entity_type, entity_value),
  KEY idx_blacklist_value (entity_value)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- audit_log  (append-only ledger of every balance-affecting operation)
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
  log_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  txn_id        BIGINT UNSIGNED NULL,
  account_id    BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action        VARCHAR(60)     NOT NULL,
  old_balance   DECIMAL(15,2)   NULL,
  new_balance   DECIMAL(15,2)   NULL,
  detail        JSON            NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (log_id),
  KEY idx_audit_txn (txn_id),
  KEY idx_audit_account (account_id),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Seed the base fraud-rule catalogue
-- -----------------------------------------------------------------------------
INSERT INTO fraud_rules
  (code, name, description, rule_type, metric, threshold, window_seconds, severity, weight) VALUES
  ('VELOCITY_TXN',      'High transaction velocity',
   'More than 5 transactions on one account within 60 seconds', 'velocity', 'txn_count', 5, 60, 'high', 20),
  ('VELOCITY_WITHDRAW', 'Rapid consecutive withdrawals',
   'More than 3 withdrawals on one account within 300 seconds', 'velocity', 'withdrawal_count', 3, 300, 'high', 25),
  ('HIGH_AMOUNT',       'Abnormally high amount',
   'Single transaction amount above 10000', 'threshold', 'amount', 10000, 0, 'medium', 20),
  ('STRUCTURING',       'Structuring / smurfing',
   'More than 2 transactions in 10 minutes each between 9000 and 9999', 'structuring', 'near_threshold_count', 2, 600, 'high', 30),
  ('GEO_MISMATCH',      'Impossible travel',
   'Two transactions on one account more than 500 km apart within 30 minutes', 'geo', 'distance_km', 500, 1800, 'critical', 40),
  ('DEVICE_REUSE',      'Shared device across customers',
   'A device fingerprint used by more than one distinct customer', 'device', 'distinct_customers', 1, 0, 'high', 40),
  ('BLACKLIST_IP',      'Blacklisted IP address', 'Transaction originates from a blacklisted IP',
   'blacklist', 'ip', 0, 0, 'critical', 45),
  ('BLACKLIST_MERCHANT','Blacklisted merchant', 'Transaction targets a blacklisted merchant',
   'blacklist', 'merchant', 0, 0, 'critical', 45);
