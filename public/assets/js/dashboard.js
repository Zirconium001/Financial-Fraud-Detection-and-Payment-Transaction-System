(function () {
  'use strict';

  const user = API.requireLogin(['analyst', 'admin']);
  if (!user) return;

  const can = (permission) => API.can(permission);
  document.getElementById('whoami').textContent = user.username + ' · ' + user.role;

  const $ = (id) => document.getElementById(id);
  const table = (headers, rows) => `
    <table><thead><tr>${headers.map((h) =>
      `<th class="${h.num ? 'num' : ''}">${API.esc(h.label || h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;

  // ---- Permission-based navigation ---------------------------------------
  const tabs = Array.from(document.querySelectorAll('.tab'));
  tabs.forEach((btn) => {
    if (btn.dataset.permission && !can(btn.dataset.permission)) {
      const section = $('tab-' + btn.dataset.tab);
      if (section) section.remove();
      btn.remove();
      return;
    }
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
      const section = $('tab-' + btn.dataset.tab);
      if (section) section.classList.remove('hidden');
    });
  });

  function activateFirstTab() {
    const active = document.querySelector('.tab.active') || document.querySelector('.tab');
    if (!active) return;
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    active.classList.add('active');
    document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
    const section = $('tab-' + active.dataset.tab);
    if (section) section.classList.remove('hidden');
  }
  activateFirstTab();

  // ---- Remove controls the current role cannot use -----------------------
  function removeIfDenied(id, permission) {
    if (!can(permission)) {
      const el = $(id);
      if (el) el.remove();
    }
  }
  removeIfDenied('block-form', 'fraud.account.block');
  removeIfDenied('recompute-risk', 'fraud.risk.recompute');
  removeIfDenied('bl-admin-card', 'fraud.blacklist.edit');
  removeIfDenied('user-admin-card', 'admin.users.manage');
  if (!can('fraud.account.block') && !can('fraud.risk.recompute')) {
    const actions = $('risk-admin-actions');
    if (actions) actions.remove();
  }

  // ---- Overview ----------------------------------------------------------
  async function loadOverview() {
    const res = await API.request('/dashboard/summary');
    const o = res.overall;
    $('stats').innerHTML = `
      <div class="card"><h3>Transactions</h3><div class="stat">${o.transactions.total_transactions}</div></div>
      <div class="card"><h3>Total Volume</h3><div class="stat small">${API.formatMoney(o.transactions.total_volume)}</div></div>
      <div class="card"><h3>Flagged</h3><div class="stat" style="color:var(--warning)">${o.transactions.flagged_transactions}</div>
        <div class="stat-label">${o.transactions.flagged_ratio_pct}% of all txns</div></div>
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
    const canReverse = can('fraud.txn.reverse');
    $('flagged-count').textContent = rows.length + ' cases';
    if (!rows.length) { $('flagged').innerHTML = '<div class="empty">No flagged transactions.</div>'; return; }

    $('flagged').innerHTML = table(
      [{ label: 'Date' }, { label: 'Account' }, { label: 'Customer' }, { label: 'Type' },
       { label: 'Amount', num: true }, { label: 'Status' }, { label: 'Risk', num: true },
       { label: 'Device' }, { label: 'Actions' }],
      rows.map((t) => `<tr>
        <td>${API.formatDate(t.created_at)}</td>
        <td>${API.esc(t.account_number)}</td>
        <td>${API.esc(t.customer_name)}</td>
        <td>${API.esc(t.txn_type)}</td>
        <td class="num">${API.formatMoney(t.amount, t.currency)}</td>
        <td>${API.badge(t.status)}</td>
        <td class="num">${t.risk_score}</td>
        <td class="muted">${API.esc((t.device_fingerprint || '').slice(0, 12))}</td>
        <td>${canReverse ? `<button class="danger small" data-reverse="${t.txn_id}">Reverse</button>` : '—'}</td>
      </tr>`)
    );

    $('flagged').querySelectorAll('[data-reverse]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Reverse transaction #' + btn.dataset.reverse + '?')) return;
        btn.disabled = true;
        try {
          await API.request('/fraud/transactions/' + btn.dataset.reverse + '/reverse', { method: 'POST' });
          API.toast('Transaction reversed', 'success');
          loadFlagged();
        } catch (err) {
          btn.disabled = false;
          API.toast(err.message, 'error');
        }
      });
    });
  }

  // ---- Rule engine -------------------------------------------------------
  async function loadRules() {
    const res = await API.request('/fraud/rules');
    const editable = can('fraud.rules.edit');
    const headers = [
      { label: 'Code' }, { label: 'Type' }, { label: 'Severity' },
      { label: 'Weight', num: true }, { label: 'Threshold', num: true },
      { label: 'Window' }, { label: 'On' }
    ];
    if (editable) headers.push({ label: 'Actions' });

    $('rules').innerHTML = table(headers, res.rules.map((r) => {
      const weight = editable
        ? `<input type="number" min="0" max="100" step="0.01" style="width:90px" data-rule-weight="${r.rule_id}" value="${r.weight}" />`
        : r.weight;
      const threshold = editable
        ? `<input type="number" min="0" step="0.01" style="width:110px" data-rule-threshold="${r.rule_id}" value="${r.threshold}" />`
        : r.threshold;
      const active = editable
        ? `<input type="checkbox" data-rule-active="${r.rule_id}" ${r.is_active ? 'checked' : ''} />`
        : (r.is_active ? '✅' : '⛔');
      const action = editable
        ? `<td><button class="small" data-save-rule="${r.rule_id}">Save</button></td>`
        : '';

      return `<tr>
        <td title="${API.esc(r.description)}"><strong>${API.esc(r.code)}</strong><br><span class="muted">${API.esc(r.name)}</span></td>
        <td>${API.esc(r.rule_type)}</td>
        <td>${API.severity(r.severity)}</td>
        <td class="num">${weight}</td>
        <td class="num">${threshold}</td>
        <td>${r.window_seconds ? r.window_seconds + 's' : '—'}</td>
        <td>${active}</td>${action}</tr>`;
    }));

    $('rule-stats').innerHTML = table(
      [{ label: 'Rule' }, { label: 'Evaluations', num: true }, { label: 'Matches', num: true }, { label: 'Total Score', num: true }],
      res.stats.map((s) => `<tr>
        <td><strong>${API.esc(s.code)}</strong></td>
        <td class="num">${s.evaluations}</td>
        <td class="num">${s.matches}</td>
        <td class="num">${s.total_score || 0}</td></tr>`)
    );
  }

  const rulesEl = $('rules');
  if (rulesEl) {
    rulesEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-save-rule]');
      if (!btn || !can('fraud.rules.edit')) return;
      const row = btn.closest('tr');
      const body = {
        weight: Number(row.querySelector('[data-rule-weight]').value),
        threshold: Number(row.querySelector('[data-rule-threshold]').value),
        is_active: row.querySelector('[data-rule-active]').checked
      };
      btn.disabled = true;
      try {
        await API.request('/fraud/rules/' + btn.dataset.saveRule, { method: 'PATCH', body });
        API.toast('Rule updated', 'success');
        await loadRules();
      } catch (err) {
        btn.disabled = false;
        API.toast(err.message, 'error');
      }
    });
  }

  // ---- Rings -------------------------------------------------------------
  async function loadRings() {
    const ip = await API.request('/fraud/rings/ips');

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
    if (!res.accounts.length) {
      $('risk').innerHTML = '<div class="empty">No accounts found.</div>';
      return;
    }

    const canBlock = can('fraud.account.block');
    const headers = [
      { label: 'Account' }, { label: 'Customer' }, { label: 'Status' },
      { label: 'Customer Risk', num: true }, { label: 'Flagged', num: true },
      { label: 'Avg Txn Risk', num: true }, { label: 'Balance', num: true }
    ];
    if (canBlock) headers.push({ label: 'Actions' });

    $('risk').innerHTML = table(
      headers,
      res.accounts.map((a) => {
        const frozen = a.account_status === 'frozen';
        const statusBadge = frozen
          ? '<span class="badge reversed">frozen</span>'
          : '<span class="badge completed">active</span>';
        const action = canBlock
          ? `<td><button class="${frozen ? 'secondary' : 'danger'} small"
                 data-act="${frozen ? 'unblock' : 'block'}"
                 data-id="${a.account_id}">${frozen ? 'Unblock' : 'Block'}</button></td>`
          : '';
        return `<tr>
          <td>${API.esc(a.account_number)}</td>
          <td>${API.esc(a.full_name)}${a.is_blocked ? ' <span class="severity high">flagged</span>' : ''}</td>
          <td>${statusBadge}</td>
          <td class="num">${a.customer_risk}</td>
          <td class="num">${a.flagged_txns}</td>
          <td class="num">${a.avg_txn_risk}</td>
          <td class="num">${API.formatMoney(a.balance)}</td>${action}</tr>`;
      })
    );
  }

  const riskEl = $('risk');
  if (riskEl) {
    riskEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || !can('fraud.account.block')) return;
      const { id, act } = btn.dataset;
      btn.disabled = true;
      try {
        await API.request('/fraud/accounts/' + id + '/' + act, { method: 'POST' });
        API.toast(act === 'block' ? 'Account blocked' : 'Account unblocked', 'success');
        await Promise.all([loadRisk(), loadOverview()]);
      } catch (err) {
        btn.disabled = false;
        API.toast(err.message, 'error');
      }
    });
  }

  const blockForm = $('block-form');
  if (blockForm) {
    blockForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const threshold = Number($('block-threshold').value);
      try {
        const result = await API.request('/fraud/block-suspicious', {
          method: 'POST',
          body: { threshold }
        });
        API.toast(
          'Blocked ' + result.accountsBlocked + ' account(s) across ' +
          result.customersBlocked + ' customer(s)',
          'success'
        );
        await Promise.all([loadRisk(), loadOverview()]);
      } catch (err) { API.toast(err.message, 'error'); }
    });
  }

  const recomputeBtn = $('recompute-risk');
  if (recomputeBtn) {
    recomputeBtn.addEventListener('click', async () => {
      recomputeBtn.disabled = true;
      try {
        await API.request('/fraud/recompute-risk', { method: 'POST' });
        API.toast('Risk scores recomputed', 'success');
        await Promise.all([loadRisk(), loadOverview()]);
      } catch (err) {
        API.toast(err.message, 'error');
      } finally {
        recomputeBtn.disabled = false;
      }
    });
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
    const editable = can('fraud.blacklist.edit');
    const headers = [
      { label: 'Type' }, { label: 'Value' }, { label: 'Severity' }, { label: 'Reason' }
    ];
    if (editable) headers.push({ label: 'Actions' });

    $('blacklist').innerHTML = res.entries.length ? table(
      headers,
      res.entries.map((b) => {
        const action = editable
          ? `<td><button class="danger small" data-del-blacklist="${b.blacklist_id}">Delete</button></td>`
          : '';
        return `<tr>
          <td>${API.esc(b.entity_type)}</td>
          <td>${API.esc(b.entity_value)}</td>
          <td>${API.severity(b.severity)}</td>
          <td class="muted">${API.esc(b.reason || '')}</td>${action}</tr>`;
      })
    ) : '<div class="empty">Blacklist is empty.</div>';
  }

  const blacklistEl = $('blacklist');
  if (blacklistEl) {
    blacklistEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-del-blacklist]');
      if (!btn || !can('fraud.blacklist.edit')) return;
      if (!confirm('Delete blacklist entry #' + btn.dataset.delBlacklist + '?')) return;
      btn.disabled = true;
      try {
        await API.request('/fraud/blacklist/' + btn.dataset.delBlacklist, { method: 'DELETE' });
        API.toast('Blacklist entry deleted', 'success');
        await loadBlacklist();
      } catch (err) {
        btn.disabled = false;
        API.toast(err.message, 'error');
      }
    });
  }

  const blForm = $('bl-form');
  if (blForm) {
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
  }

  // ---- Users (admin) -----------------------------------------------------
  async function loadUsers() {
    const res = await API.request('/admin/users');
    const manage = can('admin.users.manage');
    const headers = [
      { label: 'Username' }, { label: 'Email' }, { label: 'Role' }, { label: 'Status' }
    ];

    $('users').innerHTML = table(headers, res.users.map((u) => {
      const roleOptions = ['analyst', 'admin', 'customer', 'merchant'];
      const role = manage
        ? `<select data-user-role="${u.user_id}">${roleOptions.map((r) =>
            `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>`
        : API.esc(u.role);
      const status = manage
        ? `<button class="small ${u.is_active ? 'secondary' : 'danger'}"
             data-user-status="${u.user_id}" data-active="${u.is_active ? 1 : 0}">
             ${u.is_active ? 'Deactivate' : 'Activate'}</button>`
        : (u.is_active ? 'active' : 'inactive');

      return `<tr>
        <td>${API.esc(u.username)}</td>
        <td>${API.esc(u.email)}</td>
        <td>${role}</td>
        <td>${status}</td></tr>`;
    }));
  }

  const usersEl = $('users');
  if (usersEl) {
    usersEl.addEventListener('change', async (e) => {
      const select = e.target.closest('select[data-user-role]');
      if (!select || !can('admin.users.manage')) return;
      select.disabled = true;
      try {
        await API.request('/admin/users/' + select.dataset.userRole + '/role', {
          method: 'PATCH',
          body: { role: select.value }
        });
        API.toast('User role updated', 'success');
        await loadUsers();
      } catch (err) {
        API.toast(err.message, 'error');
        await loadUsers();
      }
    });

    usersEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-user-status]');
      if (!btn || !can('admin.users.manage')) return;
      const nextActive = btn.dataset.active !== '1';
      btn.disabled = true;
      try {
        await API.request('/admin/users/' + btn.dataset.userStatus + '/status', {
          method: 'PATCH',
          body: { isActive: nextActive }
        });
        API.toast(nextActive ? 'User activated' : 'User deactivated', 'success');
        await loadUsers();
      } catch (err) {
        btn.disabled = false;
        API.toast(err.message, 'error');
      }
    });
  }

  const userForm = $('user-form');
  if (userForm) {
    userForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = userForm.querySelector('button');
      btn.disabled = true;
      try {
        await API.request('/admin/users', {
          method: 'POST',
          body: {
            username: $('user-username').value.trim(),
            email: $('user-email').value.trim(),
            password: $('user-password').value,
            role: $('user-role').value
          }
        });
        API.toast('User created', 'success');
        userForm.reset();
        await loadUsers();
      } catch (err) {
        API.toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ---- Boot --------------------------------------------------------------
  async function guarded(name, fn, target) {
    try {
      await fn();
    } catch (err) {
      const el = $(target);
      if (el) el.innerHTML = '<div class="empty">Failed to load ' + API.esc(name) + ': ' + API.esc(err.message) + '</div>';
      API.toast(name + ': ' + err.message, 'error');
    }
  }

  async function loadAll() {
    const jobs = [
      ['Overview', loadOverview, 'stats'],
      ['Flagged queue', loadFlagged, 'flagged'],
      ['Rules', loadRules, 'rules'],
      ['Fraud rings', loadRings, 'ip-rings'],
      ['Top risk', loadRisk, 'risk'],
      ['Audit', loadAudit, 'audit'],
      ['Blacklist', loadBlacklist, 'blacklist']
    ];
    if (can('admin.users.view')) jobs.push(['Users', loadUsers, 'users']);

    await Promise.allSettled(jobs.map(([name, fn, target]) => guarded(name, fn, target)));
  }

  $('refresh').addEventListener('click', loadAll);
  loadAll();
})();
