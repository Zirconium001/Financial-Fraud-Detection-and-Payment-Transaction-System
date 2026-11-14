-- =============================================================================
--  03_triggers.sql  --  Trigger-populated auditing + integrity automation
-- =============================================================================
--  * Every balance change on `accounts` writes an append-only row in
--    `audit_log` (non-repudiation / compliance).
--  * Every new/updated transaction is recorded in `audit_log`.
--  * `audit_log` and `fraud_rule_hits` are made physically append-only:
--    any UPDATE/DELETE attempt raises an error.
--  * Devices are stamped with last-seen / last-IP on every transaction.
-- =============================================================================

USE fraud_detection;

DROP TRIGGER IF EXISTS trg_accounts_after_update;
DROP TRIGGER IF EXISTS trg_transactions_after_insert;
DROP TRIGGER IF EXISTS trg_transactions_after_update;
DROP TRIGGER IF EXISTS trg_audit_log_no_update;
DROP TRIGGER IF EXISTS trg_audit_log_no_delete;
DROP TRIGGER IF EXISTS trg_hits_no_update;
DROP TRIGGER IF EXISTS trg_hits_no_delete;

DELIMITER $$

-- ----------------------------------------------------------------------------
--  Balance-change audit (append-only ledger).
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_accounts_after_update
AFTER UPDATE ON accounts
FOR EACH ROW
BEGIN
  IF NEW.balance <> OLD.balance THEN
    INSERT INTO audit_log (account_id, action, old_balance, new_balance, detail)
    VALUES (
      NEW.account_id,
      'BALANCE_CHANGE',
      OLD.balance,
      NEW.balance,
      JSON_OBJECT('version_from', OLD.version, 'version_to', NEW.version)
    );
  END IF;
END$$

-- ----------------------------------------------------------------------------
--  New transaction ledger entry + device stamping.
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_transactions_after_insert
AFTER INSERT ON transactions
FOR EACH ROW
BEGIN
  INSERT INTO audit_log (txn_id, account_id, actor_user_id, action, detail)
  VALUES (
    NEW.txn_id,
    NEW.account_id,
    NEW.initiated_by,
    'TXN_CREATED',
    JSON_OBJECT(
      'txn_ref', NEW.txn_ref,
      'txn_type', NEW.txn_type,
      'amount', NEW.amount,
      'currency', NEW.currency,
      'status', NEW.status)
  );

  IF NEW.device_id IS NOT NULL THEN
    UPDATE devices
       SET last_seen = CURRENT_TIMESTAMP,
           last_ip   = COALESCE(NEW.ip_address, last_ip)
     WHERE device_id = NEW.device_id;
  END IF;
END$$

-- ----------------------------------------------------------------------------
--  Transaction status transitions.
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_transactions_after_update
AFTER UPDATE ON transactions
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO audit_log (txn_id, account_id, action, detail)
    VALUES (
      NEW.txn_id,
      NEW.account_id,
      'TXN_STATUS_CHANGE',
      JSON_OBJECT('from', OLD.status, 'to', NEW.status,
                  'risk_score', NEW.risk_score)
    );
  END IF;
END$$

-- ----------------------------------------------------------------------------
--  Enforce immutability of the audit + rule-hit tables.
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_audit_log_no_update
BEFORE UPDATE ON audit_log FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only (no UPDATE)';
END$$

CREATE TRIGGER trg_audit_log_no_delete
BEFORE DELETE ON audit_log FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only (no DELETE)';
END$$

CREATE TRIGGER trg_hits_no_update
BEFORE UPDATE ON fraud_rule_hits FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fraud_rule_hits is append-only (no UPDATE)';
END$$

CREATE TRIGGER trg_hits_no_delete
BEFORE DELETE ON fraud_rule_hits FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fraud_rule_hits is append-only (no DELETE)';
END$$

DELIMITER ;
