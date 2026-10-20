(function () {
  'use strict';

  const user = API.requireLogin(['analyst', 'admin']);
  if (!user) return;
  const isAdmin = user.role === 'admin';
  document.getElementById('whoami').textContent = user.username + ' · ' + user.role;

  const $ = (id) => document.getElementById(id);
  const table = (headers, rows) => `
    <table><thead><tr>${headers.map((h, i) =>
      `<th class="${h.num ? 'num' : ''}">${API.esc(h.label || h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;

  // ---- Tab switching -----------------------------------------------------
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
      $('tab-' + btn.dataset.tab).classList.remove('hidden');
    });
  });

  // ---- Overview ----------------------------------------------------------
  async function loadOverview() {
    const res = await API.request('/dashboard/summary');
    const o = res.overall;
    $('stats').innerHTML = `
      <div class="card"><h3>Transactions</h3><div class="stat">${o.transactions.total_transactions}</div></div>
      <div class="card"><h3>Total Volume</h3><div class="stat small">${API.formatMoney(o.transactions.total_volume)}</div></div>
      <div class="card"><h3>Flagged</h3><div class="stat" style="color:var(--warning)">${o.transactions.flagged_transactions}</div>
        <div class="stat-label">${o.transactions.flagged_ratio_pct}% of all txns</div></div>
      <div class="card"><h3>Device Rings</h3><div class="stat" style="color:var(--critical)">${o.deviceRings}</div>
        <div class="stat-label">shared-fingerprint clusters</div></div>
      <div class="card"><h3>Accounts</h3><div class="stat">${o.accounts.total_accounts}</div></div>
      <div class="card"><h3>Frozen Accounts</h3><div class="stat" style="color:var(--danger)">${o.accounts.frozen_accounts}</div></div>
      <div class="card"><h3>Customers</h3><div class="stat">${o.customers.total_customers}</div></div>
      <div class="card"><h3>Avg Customer Risk</h3><div class="stat">${o.customers.avg_risk || 0}</div></div>`;

    $('daily').innerHTML = table(
      [{ label: 'Date' }, { label: 'Txns', num: true }, { label: 'Volume', num: true },
       { label: 'Flagged', num: true }, { label: 'Flag %', num: true }, { label: 'Avg Risk', num: true }],
      res.daily.map((d) => `<tr>
        <td>${API.esc(d.txn_date)}</td>
        <td class="num">${d.txn_count}</td>
        <td class="num">${API.formatMoney(d.total_amount)}</td>
        <td class="num">${d.flagged_count}</td>
        <td class="num">${d.flagged_ratio_pct}</td>
        <td class="num">${d.avg_risk_score}</td></tr>`)
    );
  }

  // ---- Flagged queue -----------------------------------------------------
  async function loadFlagged() {
    const res = await API.request('/fraud/flagged?limit=100');
    const rows = res.transactions;
    $('flagged-count').textContent = rows.length + ' cases';
    if (!rows.length) { $('flagged').innerHTML = '<div class="empty">No flagged transactions.</div>'; return; }

    $('flagged').innerHTML = table(
      [{ label: 'Date' }, { label: 'Account' }, { label: 'Customer' }, { label: 'Type' },
       { label: 'Amount', num: true }, { label: 'Status' }, { label: 'Risk', num: true },
       { label: 'Device' }, { label: '' }],
      rows.map((t) => `<tr>
        <td>${API.formatDate(t.created_at)}</td>
        <td>${API.esc(t.account_number)}</td>
        <td>${API.esc(t.customer_name)}</td>
        <td>${API.esc(t.txn_type)}</td>
        <td class="num">${API.formatMoney(t.amount, t.currency)}</td>
        <td>${API.badge(t.status)}</td>
        <td class="num">${t.risk_score}</td>
        <td class="muted">${API.esc((t.device_fingerprint || '').slice(0, 12))}</td>
        <td><button class="danger small" data-reverse="${t.txn_id}">Reverse</button></td>
      </tr>`)
    );

    $('flagged').querySelectorAll('[data-reverse]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Reverse transaction #' + btn.dataset.reverse + '?')) return;
        try {
          await API.request('/fraud/transactions/' + btn.dataset.reverse + '/reverse', { method: 'POST' });
          API.toast('Transaction reversed', 'success');
          loadFlagged();
        } catch (err) { API.toast(err.message, 'error'); }
      });
    });
  }

  // ---- Rule engine -------------------------------------------------------
  async function loadRules() {
    const res = await API.request('/fraud/rules');
    $('rules').innerHTML = table(
      [{ label: 'Code' }, { label: 'Type' }, { label: 'Severity' }, { label: 'Weight', num: true }, { label: 'Window' }, { label: 'On' }],
      res.rules.map((r) => `<tr>
        <td title="${API.esc(r.description)}"><strong>${API.esc(r.code)}</strong><br><span class="muted">${API.esc(r.name)}</span></td>
        <td>${API.esc(r.rule_type)}</td>
        <td>${API.severity(r.severity)}</td>
        <td class="num">${r.weight}</td>
        <td>${r.window_seconds ? r.window_seconds + 's' : '—'}</td>
        <td>${r.is_active ? '✅' : '⛔'}</td></tr>`)
    );

    $('rule-stats').innerHTML = table(
      [{ label: 'Rule' }, { label: 'Evaluations', num: true }, { label: 'Matches', num: true }, { label: 'Total Score', num: true }],
      res.stats.map((s) => `<tr>
        <td><strong>${API.esc(s.code)}</strong></td>
        <td class="num">${s.evaluations}</td>
        <td class="num">${s.matches}</td>
        <td class="num">${s.total_score || 0}</td></tr>`)
    );
  }

  // ---- Rings -------------------------------------------------------------
  async function loadRings() {
    const [dev, ip] = await Promise.all([
      API.request('/fraud/rings/devices'),
      API.request('/fraud/rings/ips')
    ]);

    $('device-rings').innerHTML = dev.rings.length ? table(
      [{ label: 'Fingerprint' }, { label: 'Customers', num: true }, { label: 'Accounts', num: true }, { label: 'Account Numbers' }],
      dev.rings.map((r) => `<tr>
        <td class="muted">${API.esc(r.device_fingerprint)}</td>
        <td class="num">${r.distinct_customers}</td>
        <td class="num">${r.accounts_linked}</td>
        <td>${API.esc(r.account_numbers)}</td></tr>`)
    ) : '<div class="empty">No shared-device rings detected.</div>';

    $('ip-rings').innerHTML = ip.rings.length ? table(
      [{ label: 'IP Address' }, { label: 'Customers', num: true }, { label: 'Accounts', num: true }, { label: 'Account Numbers' }],
      ip.rings.map((r) => `<tr>
        <td>${API.esc(r.ip_address)}</td>
        <td class="num">${r.distinct_customers}</td>
        <td class="num">${r.accounts_linked}</td>
        <td>${API.esc(r.account_numbers)}</td></tr>`)
    ) : '<div class="empty">No shared-IP rings detected.</div>';
  }

  // ---- Top risk ----------------------------------------------------------
  async function loadRisk() {
    const res = await API.request('/fraud/top-risk?limit=25');
    $('risk').innerHTML = table(
      [{ label: 'Account' }, { label: 'Customer' }, { label: 'Customer Risk', num: true },
       { label: 'Flagged', num: true }, { label: 'Avg Txn Risk', num: true }, { label: 'Balance', num: true }],
      res.accounts.map((a) => `<tr>
        <td>${API.esc(a.account_number)}</td>
        <td>${API.esc(a.full_name)}</td>
        <td class="num">${a.customer_risk}</td>
        <td class="num">${a.flagged_txns}</td>
        <td class="num">${a.avg_txn_risk}</td>
        <td class="num">${API.formatMoney(a.balance)}</td></tr>`)
    );
  }

  // ---- Audit -------------------------------------------------------------
  async function loadAudit() {
    const res = await API.request('/dashboard/audit?limit=100');
    $('audit').innerHTML = table(
      [{ label: 'When' }, { label: 'Action' }, { label: 'Account' }, { label: 'Txn' }, { label: 'Old', num: true }, { label: 'New', num: true }, { label: 'Detail' }],
      res.audit.map((l) => `<tr>
        <td>${API.formatDate(l.created_at)}</td>
        <td><strong>${API.esc(l.action)}</strong></td>
        <td>${API.esc(l.account_number || l.account_id || '')}</td>
        <td>${l.txn_id || ''}</td>
        <td class="num">${l.old_balance != null ? API.formatMoney(l.old_balance) : ''}</td>
        <td class="num">${l.new_balance != null ? API.formatMoney(l.new_balance) : ''}</td>
        <td class="muted" style="font-size:12px;">${API.esc(JSON.stringify(l.detail || {}))}</td></tr>`)
    );
  }

  // ---- Blacklist ---------------------------------------------------------
  async function loadBlacklist() {
    const res = await API.request('/fraud/blacklist');
    $('blacklist').innerHTML = res.entries.length ? table(
      [{ label: 'Type' }, { label: 'Value' }, { label: 'Severity' }, { label: 'Reason' }],
      res.entries.map((b) => `<tr>
        <td>${API.esc(b.entity_type)}</td>
        <td>${API.esc(b.entity_value)}</td>
        <td>${API.severity(b.severity)}</td>
        <td class="muted">${API.esc(b.reason || '')}</td></tr>`)
    ) : '<div class="empty">Blacklist is empty.</div>';
  }

  const blForm = $('bl-form');
  if (!isAdmin) {
    blForm.querySelector('button').disabled = true;
    blForm.insertAdjacentHTML('beforeend', '<p class="muted">Only admins can add entries.</p>');
  }
  blForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await API.request('/fraud/blacklist', {
        method: 'POST',
        body: {
          entityType: $('bl-type').value,
          entityValue: $('bl-value').value.trim(),
          reason: $('bl-reason').value.trim()
        }
      });
      API.toast('Added to blacklist', 'success');
      $('bl-value').value = ''; $('bl-reason').value = '';
      loadBlacklist();
    } catch (err) { API.toast(err.message, 'error'); }
  });

  // ---- Boot --------------------------------------------------------------
  async function loadAll() {
    try {
      await Promise.all([loadOverview(), loadFlagged(), loadRules(), loadRings(), loadRisk(), loadAudit(), loadBlacklist()]);
    } catch (err) { API.toast(err.message, 'error'); }
  }

  $('refresh').addEventListener('click', loadAll);
  loadAll();
})();
