(function () {
  'use strict';

  const user = API.requireLogin(['merchant']);
  if (!user) return;
  document.getElementById('whoami').textContent = user.username + ' · ' + user.role;

  async function load() {
    const res = await API.request('/dashboard/merchant-settlement');
    const rows = res.settlement;

    const totalGross = rows.reduce((s, r) => s + Number(r.gross_amount || 0), 0);
    const totalTxns = rows.reduce((s, r) => s + Number(r.txn_count || 0), 0);
    const totalFlagged = rows.reduce((s, r) => s + Number(r.flagged_count || 0), 0);

    document.getElementById('summary').innerHTML = `
      <div class="card"><h3>Gross settled</h3><div class="stat">${API.formatMoney(totalGross)}</div></div>
      <div class="card"><h3>Transactions</h3><div class="stat">${totalTxns}</div></div>
      <div class="card"><h3>Flagged</h3><div class="stat" style="color:var(--warning)">${totalFlagged}</div></div>`;

    if (!rows.length) {
      document.getElementById('table').innerHTML = '<div class="empty">No settlement data.</div>';
      return;
    }

    document.getElementById('table').innerHTML = `
      <table>
        <thead><tr><th>Merchant</th><th>Category</th><th>Risk</th><th class="num">Txns</th><th class="num">Gross</th><th class="num">Flagged</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${API.esc(r.name)}</td>
              <td>${API.esc(r.category)}</td>
              <td>${API.severity(r.risk_level)}</td>
              <td class="num">${r.txn_count}</td>
              <td class="num">${API.formatMoney(r.gross_amount)}</td>
              <td class="num">${r.flagged_count}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  load().catch((err) => API.toast(err.message, 'error'));
})();
