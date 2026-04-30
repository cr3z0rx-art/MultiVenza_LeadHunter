'use strict';

/**
 * scripts/sync_from_output.js
 *
 * Replays an existing leads_florida_wc_all_*.json file to the SaaS API
 * without re-running the full scraper.
 *
 * Usage:
 *   node scripts/sync_from_output.js                  # latest all-leads file
 *   node scripts/sync_from_output.js --file=output/leads_florida_wc_all_2026-04-30.json
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { syncFLLeads } = require('./lib/saas_sync');

// ── Resolve input file ────────────────────────────────────────────────────────

function resolveFile() {
  const fileArg = process.argv.find(a => a.startsWith('--file='));
  if (fileArg) {
    return fileArg.split('=')[1];
  }

  // Find the most recent all-leads file
  const dir = path.join(__dirname, '../output');
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('leads_florida_wc_all_') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (!files.length) {
    console.error('No leads_florida_wc_all_*.json files found in ./output/');
    process.exit(1);
  }

  return path.join(dir, files[0]);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const filePath = resolveFile();
  console.log(`\n[sync_from_output] Reading: ${filePath}`);

  const raw   = fs.readFileSync(filePath, 'utf8');
  const leads = JSON.parse(raw);

  console.log(`[sync_from_output] ${leads.length} leads loaded`);

  if (!leads.length) {
    console.warn('[sync_from_output] No leads to sync. Exiting.');
    process.exit(0);
  }

  const date    = path.basename(filePath).match(/(\d{4}-\d{2}-\d{2})/)?.[1] || new Date().toISOString().slice(0, 10);
  const batchId = `FL-${date}`;

  await syncFLLeads(leads, batchId);

  console.log('[sync_from_output] Done.\n');
}

main().catch(err => {
  console.error('[sync_from_output] Fatal:', err.message);
  process.exit(1);
});
