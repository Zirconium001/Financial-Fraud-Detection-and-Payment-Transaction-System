-- =============================================================================
--  02_procedures.sql  --  ACID transaction processing + fraud-scoring engine
-- =============================================================================
--  These procedures are TRANSACTION-AGNOSTIC: they assume they are invoked
--  from within a caller-managed transaction (the Node backend issues
--  START TRANSACTION / SET TRANSACTION ISOLATION LEVEL / COMMIT / ROLLBACK).
--  On any business error they raise SIGNAL SQLSTATE '45000' so the caller
--  rolls the whole unit back. For CLI/phpMyAdmin testing wrap calls in
--  START TRANSACTION ... COMMIT (see README "Manual SQL testing").
--
--  Locking strategy
--  ----------------
--  * Pessimistic: SELECT ... FOR UPDATE on the account row(s).
--  * Optimistic : accounts.version is incremented on every balance change so
--    clients can detect stale reads; the procedures here rely on the
--    pessimistic row locks to guarantee correctness.
--  * Transfers always lock accounts in ascending account_id order to prevent
--    deadlocks between opposing transfers.
-- =============================================================================

USE fraud_detection;

DROP PROCEDURE IF EXISTS sp_link_device;
DROP PROCEDURE IF EXISTS sp_deposit;
DROP PROCEDURE IF EXISTS sp_withdraw;
DROP PROCEDURE IF EXISTS sp_transfer;
DROP PROCEDURE IF EXISTS sp_payment;
DROP PROCEDURE IF EXISTS sp_evaluate_transaction;
DROP PROCEDURE IF EXISTS sp_reverse_transaction;
DROP PROCEDURE IF EXISTS sp_recompute_customer_risk;
DROP PROCEDURE IF EXISTS sp_recompute_all_risk;

DELIMITER $$

-- -----------------------------------------------------------------------------
--  sp_evaluate_transaction : the rule-based scoring engine.
--  Reads the active rule catalogue in fraud_rules and evaluates the given
--  transaction against every rule, writing an immutable row in
--  fraud_rule_hits for each evaluation and updating the transaction's
--  risk_score + status.
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_evaluate_transaction (
  IN  p_txn_id BIGINT UNSIGNED,
  OUT p_risk   DECIMAL(5,2),
  OUT p_status VARCHAR(20)
)
BEGIN
  DECLARE v_account_id  BIGINT UNSIGNED;
  DECLARE v_amount      DECIMAL(15,2);
  DECLARE v_txn_type    VARCHAR(20);
  DECLARE v_device_id   BIGINT UNSIGNED;
  DECLARE v_merchant_id BIGINT UNSIGNED;
  DECLARE v_ip          VARCHAR(45);
  DECLARE v_lat         DECIMAL(9,6);
  DECLARE v_lon         DECIMAL(9,6);
  DECLARE v_created     TIMESTAMP;

  DECLARE v_score       DECIMAL(7,2) DEFAULT 0;
  DECLARE v_contribution DECIMAL(5,2);
  DECLARE v_matched     TINYINT(1);
  DECLARE v_metric      DECIMAL(15,2);
  DECLARE v_details     JSON;

  DECLARE v_done        TINYINT DEFAULT 0;
  DECLARE v_rule_id     BIGINT UNSIGNED;
  DECLARE v_code        VARCHAR(40);
  DECLARE v_threshold   DECIMAL(15,2);
  DECLARE v_window      INT UNSIGNED;
  DECLARE v_weight      DECIMAL(5,2);
  DECLARE v_severity    VARCHAR(20);

  DECLARE cur_rules CURSOR FOR
    SELECT rule_id, code, threshold, window_seconds, weight, severity
    FROM fraud_rules WHERE is_active = 1;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

  SELECT account_id, amount, txn_type, device_id, merchant_id, ip_address,
         latitude, longitude, created_at
    INTO v_account_id, v_amount, v_txn_type, v_device_id, v_merchant_id,
         v_ip, v_lat, v_lon, v_created
    FROM transactions WHERE txn_id = p_txn_id;

  IF v_account_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sp_evaluate_transaction: unknown txn_id';
  END IF;

  SET v_done = 0;
  OPEN cur_rules;
  read_loop: LOOP
    FETCH cur_rules INTO v_rule_id, v_code, v_threshold, v_window, v_weight, v_severity;
    IF v_done = 1 THEN LEAVE read_loop; END IF;

    SET v_matched = 0;
    SET v_metric  = 0;
    SET v_details = NULL;

    -- ===================== RULE IMPLEMENTATIONS =========================
    IF v_code = 'VELOCITY_TXN' THEN
      SELECT COUNT(*) INTO v_metric
        FROM transactions
       WHERE account_id = v_account_id
         AND created_at >= DATE_SUB(v_created, INTERVAL v_window SECOND)
         AND created_at <= v_created;
      SET v_matched = (v_metric > v_threshold);
      SET v_details = JSON_OBJECT('txn_count', v_metric, 'window_seconds', v_window);

    ELSEIF v_code = 'VELOCITY_WITHDRAW' THEN
      SELECT COUNT(*) INTO v_metric
        FROM transactions
       WHERE account_id = v_account_id
         AND txn_type = 'withdrawal'
         AND created_at >= DATE_SUB(v_created, INTERVAL v_window SECOND)
         AND created_at <= v_created;
      SET v_matched = (v_metric > v_threshold);
      SET v_details = JSON_OBJECT('withdrawal_count', v_metric, 'window_seconds', v_window);

    ELSEIF v_code = 'HIGH_AMOUNT' THEN
      SET v_metric = v_amount;
      SET v_matched = (v_amount > v_threshold);
      SET v_details = JSON_OBJECT('amount', v_amount, 'threshold', v_threshold);

    ELSEIF v_code = 'STRUCTURING' THEN
      SELECT COUNT(*) INTO v_metric
        FROM transactions
       WHERE account_id = v_account_id
         AND amount BETWEEN 9000 AND 9999
         AND created_at >= DATE_SUB(v_created, INTERVAL v_window SECOND)
         AND created_at <= v_created;
      SET v_matched = (v_metric > v_threshold);
      SET v_details = JSON_OBJECT('near_threshold_count', v_metric, 'band', '9000-9999');

    ELSEIF v_code = 'GEO_MISMATCH' THEN
      SELECT (
        SELECT ROUND(6371 * 2 * ASIN(SQRT(
                 POWER(SIN(RADIANS(t.latitude - v_lat) / 2), 2) +
                 COS(RADIANS(v_lat)) * COS(RADIANS(t.latitude)) *
                 POWER(SIN(RADIANS(t.longitude - v_lon) / 2), 2)
               )), 2)
          FROM transactions t
         WHERE t.account_id = v_account_id
           AND t.txn_id <> p_txn_id
           AND t.latitude IS NOT NULL AND t.longitude IS NOT NULL
           AND v_lat IS NOT NULL AND v_lon IS NOT NULL
           AND t.created_at >= DATE_SUB(v_created, INTERVAL v_window SECOND)
           AND t.created_at <= v_created
         ORDER BY t.created_at DESC
         LIMIT 1
      ) INTO v_metric;
      SET v_metric = COALESCE(v_metric, 0);
      SET v_matched = (v_metric > v_threshold);
      SET v_details = JSON_OBJECT('distance_km', v_metric, 'threshold_km', v_threshold);

    ELSEIF v_code = 'DEVICE_REUSE' THEN
      IF v_device_id IS NOT NULL THEN
        SELECT COUNT(DISTINCT a.customer_id) INTO v_metric
          FROM transactions t
          JOIN accounts a ON a.account_id = t.account_id
         WHERE t.device_id = v_device_id;
      ELSE
        SET v_metric = 0;
      END IF;
      SET v_matched = (v_metric > v_threshold);
      SET v_details = JSON_OBJECT('distinct_customers', v_metric, 'device_id', v_device_id);

    ELSEIF v_code = 'BLACKLIST_IP' THEN
      SELECT COUNT(*) INTO v_metric
        FROM blacklist
       WHERE entity_type = 'ip' AND entity_value = v_ip;
      SET v_matched = (v_ip IS NOT NULL AND v_metric > 0);
      SET v_details = JSON_OBJECT('ip', v_ip);

    ELSEIF v_code = 'BLACKLIST_MERCHANT' THEN
      SELECT COUNT(*) INTO v_metric
        FROM merchants m
       WHERE m.merchant_id = v_merchant_id AND m.is_blacklisted = 1;
      SET v_matched = (v_merchant_id IS NOT NULL AND v_metric > 0);
      SET v_details = JSON_OBJECT('merchant_id', v_merchant_id);

    ELSE
      SET v_matched = 0;
    END IF;
    -- ====================================================================

    SET v_contribution = IF(v_matched = 1, v_weight, 0);

    INSERT INTO fraud_rule_hits
      (txn_id, rule_id, matched, score_contribution, details)
    VALUES
      (p_txn_id, v_rule_id, v_matched, v_contribution, v_details);

    SET v_score = v_score + v_contribution;
  END LOOP;
  CLOSE cur_rules;

  SET v_score = LEAST(v_score, 100);

  IF v_score >= 70 THEN
    SET p_status = 'quarantined';
  ELSEIF v_score >= 40 THEN
    SET p_status = 'flagged';
  ELSE
    SET p_status = 'completed';
  END IF;
  SET p_risk = v_score;

  UPDATE transactions
     SET risk_score = v_score, status = p_status
   WHERE txn_id = p_txn_id;

  -- Escalate the owning customer's rolling risk score.
  UPDATE customers c
     SET c.risk_score = LEAST(100, c.risk_score + ROUND(v_score / 5, 2))
   WHERE c.customer_id = (SELECT customer_id FROM accounts WHERE account_id = v_account_id);
END$$

-- -----------------------------------------------------------------------------
--  sp_link_device : maintain the account_devices M:N relationship
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_link_device (
  IN p_account_id BIGINT UNSIGNED,
  IN p_device_id  BIGINT UNSIGNED
)
BEGIN
  IF p_device_id IS NOT NULL THEN
    INSERT INTO account_devices (account_id, device_id, times_used)
    VALUES (p_account_id, p_device_id, 1)
    ON DUPLICATE KEY UPDATE times_used = times_used + 1;
  END IF;
END$$

-- -----------------------------------------------------------------------------
--  sp_deposit
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_deposit (
  IN  p_account_id BIGINT UNSIGNED,
  IN  p_amount     DECIMAL(15,2),
  IN  p_actor      BIGINT UNSIGNED,
  IN  p_device     BIGINT UNSIGNED,
  IN  p_ip         VARCHAR(45),
  OUT p_txn_id     BIGINT UNSIGNED,
  OUT p_risk       DECIMAL(5,2),
  OUT p_status     VARCHAR(20)
)
BEGIN
  DECLARE v_status VARCHAR(20);
  DECLARE v_old    DECIMAL(15,2);

  IF p_amount <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deposit amount must be positive';
  END IF;

  SELECT status, balance INTO v_status, v_old
    FROM accounts WHERE account_id = p_account_id FOR UPDATE;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account not found';
  END IF;
  IF v_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account is not active';
  END IF;

  INSERT INTO transactions
    (txn_ref, account_id, txn_type, amount, device_id, initiated_by, ip_address, status, description)
  VALUES
    (UUID(), p_account_id, 'deposit', p_amount, p_device, p_actor, p_ip, 'pending', 'Deposit');

  SET p_txn_id = LAST_INSERT_ID();

  UPDATE accounts
     SET balance = balance + p_amount, version = version + 1
   WHERE account_id = p_account_id;

  CALL sp_link_device(p_account_id, p_device);
  CALL sp_evaluate_transaction(p_txn_id, p_risk, p_status);
END$$

-- -----------------------------------------------------------------------------
--  sp_withdraw
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_withdraw (
  IN  p_account_id BIGINT UNSIGNED,
  IN  p_amount     DECIMAL(15,2),
  IN  p_actor      BIGINT UNSIGNED,
  IN  p_device     BIGINT UNSIGNED,
  IN  p_ip         VARCHAR(45),
  IN  p_lat        DECIMAL(9,6),
  IN  p_lon        DECIMAL(9,6),
  OUT p_txn_id     BIGINT UNSIGNED,
  OUT p_risk       DECIMAL(5,2),
  OUT p_status     VARCHAR(20)
)
BEGIN
  DECLARE v_status VARCHAR(20);
  DECLARE v_balance DECIMAL(15,2);

  IF p_amount <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal amount must be positive';
  END IF;

  SELECT status, balance INTO v_status, v_balance
    FROM accounts WHERE account_id = p_account_id FOR UPDATE;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account not found';
  END IF;
  IF v_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account is not active';
  END IF;
  IF v_balance < p_amount THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient funds';
  END IF;

  INSERT INTO transactions
    (txn_ref, account_id, txn_type, amount, device_id, initiated_by, ip_address,
     latitude, longitude, status, description)
  VALUES
    (UUID(), p_account_id, 'withdrawal', p_amount, p_device, p_actor, p_ip,
     p_lat, p_lon, 'pending', 'Withdrawal');

  SET p_txn_id = LAST_INSERT_ID();

  UPDATE accounts
     SET balance = balance - p_amount, version = version + 1
   WHERE account_id = p_account_id;

  CALL sp_link_device(p_account_id, p_device);
  CALL sp_evaluate_transaction(p_txn_id, p_risk, p_status);
END$$

-- -----------------------------------------------------------------------------
--  sp_transfer  (atomic double-entry move, deadlock-safe lock ordering)
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_transfer (
  IN  p_from       BIGINT UNSIGNED,
  IN  p_to         BIGINT UNSIGNED,
  IN  p_amount     DECIMAL(15,2),
  IN  p_actor      BIGINT UNSIGNED,
  IN  p_device     BIGINT UNSIGNED,
  IN  p_ip         VARCHAR(45),
  IN  p_lat        DECIMAL(9,6),
  IN  p_lon        DECIMAL(9,6),
  OUT p_txn_out    BIGINT UNSIGNED,
  OUT p_txn_in     BIGINT UNSIGNED,
  OUT p_risk       DECIMAL(5,2),
  OUT p_status     VARCHAR(20)
)
BEGIN
  DECLARE v_first      BIGINT UNSIGNED;
  DECLARE v_second     BIGINT UNSIGNED;
  DECLARE v_from_status VARCHAR(20);
  DECLARE v_from_bal   DECIMAL(15,2);
  DECLARE v_to_status  VARCHAR(20);
  DECLARE v_lock_id    BIGINT UNSIGNED;
  DECLARE v_dummy      VARCHAR(20);
  DECLARE v_dummy2     DECIMAL(15,2);

  IF p_amount <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer amount must be positive';
  END IF;
  IF p_from = p_to THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot transfer to the same account';
  END IF;

  -- Deterministic lock order: always lock the lower account_id first.
  IF p_from < p_to THEN
    SET v_first = p_from; SET v_second = p_to;
  ELSE
    SET v_first = p_to;   SET v_second = p_from;
  END IF;

  SELECT status, balance INTO v_dummy, v_dummy2
    FROM accounts WHERE account_id = v_first FOR UPDATE;
  SELECT status, balance INTO v_dummy, v_dummy2
    FROM accounts WHERE account_id = v_second FOR UPDATE;

  SELECT status, balance INTO v_from_status, v_from_bal
    FROM accounts WHERE account_id = p_from;
  SELECT status INTO v_to_status
    FROM accounts WHERE account_id = p_to;

  IF v_from_status IS NULL OR v_to_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Source or destination account not found';
  END IF;
  IF v_from_status <> 'active' OR v_to_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'One of the accounts is not active';
  END IF;
  IF v_from_bal < p_amount THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient funds';
  END IF;

  INSERT INTO transactions
    (txn_ref, account_id, txn_type, amount, counterparty_account,
     device_id, initiated_by, ip_address, latitude, longitude, status, description)
  VALUES
    (UUID(), p_from, 'transfer_out', p_amount, p_to,
     p_device, p_actor, p_ip, p_lat, p_lon, 'pending', 'Transfer out');

  SET p_txn_out = LAST_INSERT_ID();

  INSERT INTO transactions
    (txn_ref, account_id, txn_type, amount, counterparty_account,
     initiated_by, ip_address, status, description)
  VALUES
    (UUID(), p_to, 'transfer_in', p_amount, p_from,
     p_actor, p_ip, 'pending', 'Transfer in');

  SET p_txn_in = LAST_INSERT_ID();

  UPDATE accounts SET balance = balance - p_amount, version = version + 1
   WHERE account_id = p_from;
  UPDATE accounts SET balance = balance + p_amount, version = version + 1
   WHERE account_id = p_to;

  CALL sp_link_device(p_from, p_device);
  CALL sp_evaluate_transaction(p_txn_out, p_risk, p_status);
  UPDATE transactions SET risk_score = p_risk, status = p_status WHERE txn_id = p_txn_in;
END$$

-- -----------------------------------------------------------------------------
--  sp_payment : debit an account for a merchant purchase.
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_payment (
  IN  p_account_id  BIGINT UNSIGNED,
  IN  p_merchant_id BIGINT UNSIGNED,
  IN  p_amount      DECIMAL(15,2),
  IN  p_actor       BIGINT UNSIGNED,
  IN  p_device      BIGINT UNSIGNED,
  IN  p_ip          VARCHAR(45),
  IN  p_lat         DECIMAL(9,6),
  IN  p_lon         DECIMAL(9,6),
  OUT p_txn_id      BIGINT UNSIGNED,
  OUT p_risk        DECIMAL(5,2),
  OUT p_status      VARCHAR(20)
)
BEGIN
  DECLARE v_status  VARCHAR(20);
  DECLARE v_balance DECIMAL(15,2);

  IF p_amount <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment amount must be positive';
  END IF;

  SELECT status, balance INTO v_status, v_balance
    FROM accounts WHERE account_id = p_account_id FOR UPDATE;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account not found';
  END IF;
  IF v_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account is not active';
  END IF;
  IF v_balance < p_amount THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient funds';
  END IF;

  INSERT INTO transactions
    (txn_ref, account_id, txn_type, amount, merchant_id, device_id,
     initiated_by, ip_address, latitude, longitude, status, description)
  VALUES
    (UUID(), p_account_id, 'payment', p_amount, p_merchant_id, p_device,
     p_actor, p_ip, p_lat, p_lon, 'pending', 'Merchant payment');

  SET p_txn_id = LAST_INSERT_ID();

  UPDATE accounts
     SET balance = balance - p_amount, version = version + 1
   WHERE account_id = p_account_id;

  CALL sp_link_device(p_account_id, p_device);
  CALL sp_evaluate_transaction(p_txn_id, p_risk, p_status);
END$$

-- -----------------------------------------------------------------------------
--  sp_reverse_transaction : analyst action to refund a flagged transaction
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_reverse_transaction (
  IN p_txn_id BIGINT UNSIGNED,
  IN p_actor  BIGINT UNSIGNED
)
BEGIN
  DECLARE v_account BIGINT UNSIGNED;
  DECLARE v_amount  DECIMAL(15,2);
  DECLARE v_type    VARCHAR(20);
  DECLARE v_status  VARCHAR(20);
  DECLARE v_lock    BIGINT UNSIGNED;

  SELECT account_id, amount, txn_type, status
    INTO v_account, v_amount, v_type, v_status
    FROM transactions WHERE txn_id = p_txn_id FOR UPDATE;

  IF v_account IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transaction not found';
  END IF;
  IF v_status = 'reversed' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transaction already reversed';
  END IF;

  SELECT account_id INTO v_lock FROM accounts WHERE account_id = v_account FOR UPDATE;

  IF v_type = 'withdrawal' OR v_type = 'transfer_out' OR v_type = 'payment' THEN
    UPDATE accounts SET balance = balance + v_amount, version = version + 1
     WHERE account_id = v_account;
  ELSEIF v_type = 'deposit' OR v_type = 'transfer_in' THEN
    UPDATE accounts SET balance = balance - v_amount, version = version + 1
     WHERE account_id = v_account;
  END IF;

  UPDATE transactions SET status = 'reversed' WHERE txn_id = p_txn_id;

  INSERT INTO audit_log (txn_id, account_id, actor_user_id, action, detail)
  VALUES (p_txn_id, v_account, p_actor, 'REVERSE',
          JSON_OBJECT('amount', v_amount, 'txn_type', v_type));
END$$

-- -----------------------------------------------------------------------------
--  sp_recompute_customer_risk : derive risk from open flagged/quarantined txns
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_recompute_customer_risk (IN p_customer_id BIGINT UNSIGNED)
BEGIN
  UPDATE customers c
     SET c.risk_score = LEAST(100, (
       SELECT COALESCE(AVG(t.risk_score), 0)
         FROM transactions t
         JOIN accounts a ON a.account_id = t.account_id
        WHERE a.customer_id = p_customer_id
          AND t.status IN ('flagged','quarantined')
     ))
   WHERE c.customer_id = p_customer_id;
END$$

CREATE PROCEDURE sp_recompute_all_risk ()
BEGIN
  UPDATE customers c
     SET c.risk_score = LEAST(100, (
       SELECT COALESCE(AVG(t.risk_score), 0)
         FROM transactions t
         JOIN accounts a ON a.account_id = t.account_id
        WHERE a.customer_id = c.customer_id
          AND t.status IN ('flagged','quarantined')
     ));
END$$

DELIMITER ;

-- -----------------------------------------------------------------------------
--  sp_detect_fraud_rings : self-join over account_devices to surface groups of
--  accounts (potentially different customers) sharing the same device.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_fraud_ring_devices;
CREATE VIEW v_fraud_ring_devices AS
SELECT
  d.device_id,
  d.device_fingerprint,
  COUNT(DISTINCT a.customer_id)              AS distinct_customers,
  COUNT(DISTINCT ad.account_id)              AS accounts_linked,
  GROUP_CONCAT(DISTINCT a.account_number ORDER BY a.account_number SEPARATOR ', ') AS account_numbers,
  GROUP_CONCAT(DISTINCT c.customer_id   ORDER BY c.customer_id SEPARATOR ', ')     AS customer_ids
FROM devices d
JOIN account_devices ad ON ad.device_id = d.device_id
JOIN accounts a         ON a.account_id = ad.account_id
JOIN customers c        ON c.customer_id = a.customer_id
GROUP BY d.device_id, d.device_fingerprint
HAVING distinct_customers > 1
ORDER BY distinct_customers DESC, accounts_linked DESC;
