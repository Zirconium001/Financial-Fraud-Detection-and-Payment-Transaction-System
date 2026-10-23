'use strict';

/**
 * simulate-fraud.js
 * Standalone runner that injects synthetic fraud patterns into an
 * already-initialised database and prints the resulting detections.
 *
 *   node scripts/simulate-fraud.js
 */

const { simulate, summarize, buildPool } = require('./lib/fraud-sim');

async function main() {
  const pool = buildPool();
  console.log('\n== Injecting synthetic fraud patterns ==\n');

  const sim = await simulate(pool);
  console.log(`  injected ${sim.ok.length} transaction(s), ${sim.failed.length} skipped`);
  for (const f of sim.failed) console.log(`    - ${f.label}: ${f.error}`);

  await pool.query('CALL sp_recompute_all_risk()');
  const summary = await summarize(pool);

  console.log(`\n  transactions: ${summary.transactions.total} ` +
    `(completed ${summary.transactions.completed}, flagged ${summary.transactions.flagged}, quarantined ${summary.transactions.quarantined})`);
  console.log('  rule matches:');
  for (const r of summary.ruleMatches) console.log(`    ${r.code.padEnd(20)} ${r.matches}`);
  console.log('');

  await pool.end();
}

main().catch((err) => {
  console.error('Simulation error:', err.message);
  process.exit(1);
});
