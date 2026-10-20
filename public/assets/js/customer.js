(function () {
  'use strict';

  const user = API.requireLogin(['customer', 'admin']);
  if (!user) return;

  document.getElementById('whoami').textContent =
    user.username + ' · ' + user.role;

  const state = { accounts: [] };
  const opSelect = document.getElementById('op');
  const toWrap = document.getElementById('toWrap');
  const merchantWrap = document.getElementById('merchantWrap');

  opSelect.addEventListener('change', () => {
    toWrap.classList.toggle('hidden', opSelect.value !== 'transfer');
    merchantWrap.classList.toggle('hidden', opSelect.value !== 'payment');
  });

  async function loadAccounts() {
    const res = await API.request('/accounts');
    state.accounts = res.accounts;

    document.getElementById('accounts').innerHTML = res.accounts.map((a) => `
      <div class="card">
        <h3>${API.esc(a.account_type)} · ${API.esc(a.currency)}</h3>
        <div class="stat">${API.formatMoney(a.balance, a.currency)}</div>
        <div class="stat-label">${API.esc(a.account_number)}</div>
        <div class="stat-label">status: ${a.status} · risk: ${a.risk_score}</div>
      </div>
    `).join('') || '<div class="empty">No accounts.</div>';

    document.getElementById('fromAccount').innerHTML = res.accounts.map((a) =>
      `<option value="${a.account_id}">${API.esc(a.account_number)} (${API.formatMoney(a.balance, a.currency)})</option>`
    ).join('');
  }

  async function loadTransactions() {
    const res = await API.request('/transactions?limit=30');
    const rows = res.transactions;
    if (!rows.length) {
      document.getElementById('txns').innerHTML = '<div class="empty">No transactions yet.</div>';
      return;
    }
    document.getElementById('txns').innerHTML = `
      <table>
        <thead><tr><th>Date</th><th>Type</th><th class="num">Amount</th><th>Status</th><th class="num">Risk</th></tr></thead>
        <tbody>
          ${rows.map((t) => `
            <tr>
              <td>${API.formatDate(t.created_at)}</td>
              <td>${API.esc(t.txn_type)}</td>
              <td class="num">${API.formatMoney(t.amount, t.currency)}</td>
              <td>${API.badge(t.status)}</td>
              <td class="num">${t.risk_score}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  document.getElementById('txn-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const op = opSelect.value;
    const accountId = Number(document.getElementById('fromAccount').value);
    const amount = Number(document.getElementById('amount').value);

    try {
      if (op === 'deposit') {
        await API.request('/transactions/deposit', { method: 'POST', body: { accountId, amount } });
      } else if (op === 'withdraw') {
        await API.request('/transactions/withdraw', { method: 'POST', body: { accountId, amount } });
      } else if (op === 'payment') {
        const merchantId = Number(document.getElementById('merchantId').value);
        await API.request('/transactions/payment', {
          method: 'POST',
          body: { accountId, merchantId, amount }
        });
      } else {
        const toAccountId = Number(document.getElementById('toAccount').value);
        await API.request('/transactions/transfer', {
          method: 'POST',
          body: { fromAccountId: accountId, toAccountId, amount }
        });
      }
      API.toast('Transaction processed', 'success');
      document.getElementById('amount').value = '';
      await Promise.all([loadAccounts(), loadTransactions()]);
    } catch (err) {
      API.toast(err.message, 'error');
    }
  });

  Promise.all([loadAccounts(), loadTransactions()]).catch((err) => API.toast(err.message, 'error'));
})();
