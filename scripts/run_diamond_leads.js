'use strict';

/**
 * scripts/run_diamond_leads.js
 *
 * Extracts and scores "Diamond" quality leads:
 *   - Hillsborough: real Accela permit data via public ArcGIS REST API
 *   - Sarasota:     realistic demo data (no public API available for Sarasota)
 *
 * Diamond = any combination of:
 *   ★ PREMIUM city (Siesta Key / Longboat Key / Lakewood Ranch)
 *   ★ No-GC (owner-builder — direct access to decision maker)
 *   ★ 15-year roof rule (insurance-forced replacement)
 *   ★ High valuation (>$50k)
 *
 * Usage:
 *   node scripts/run_diamond_leads.js
 *   node scripts/run_diamond_leads.js --days=14   (default: 30)
 *   node scripts/run_diamond_leads.js --max=100   (max records per county, default: 200)
 *   node scripts/run_diamond_leads.js --top=50    (leads to show in preview, default: 50)
 */

require('dotenv').config();

const path            = require('path');
const fs              = require('fs');
const config          = require('../config.json');
const ArcGISExtractor = require('../src/arcgis_extractor');
const Processor       = require('../src/processor');
const Logger          = require('../src/utils/logger');
const { syncFLLeads, syncToSupabase } = require('./lib/saas_sync');

// ─── Parse CLI args ────────────────────────────────────────────────────────

function argVal(flag, defaultVal) {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`));
  return arg ? parseInt(arg.split('=')[1], 10) : defaultVal;
}

const DAYS    = argVal('days', 3);
const MAX     = argVal('max',  200);
const TOP     = argVal('top',   50);

const logger = new Logger(config.logging);

// ─── Helpers ───────────────────────────────────────────────────────────────

function bar(score) {
  const filled = Math.round(score / 5);
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
}

function fmt$(n) {
  return n ? `$${Math.round(n).toLocaleString('en-US')}` : '$0';
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  logger.separator('DIAMOND LEADS RUN');
  logger.info(`Days back   : ${DAYS}`);
  logger.info(`Max/county  : ${MAX}`);
  logger.info(`Preview top : ${TOP}`);
  logger.info(`Start time  : ${new Date().toISOString()}`);

  // ── 1. Extract ─────────────────────────────────────────────────────────────
  const extractor = new ArcGISExtractor(config);
  const rawRecords = await extractor.run({
    counties:         ['Hillsborough', 'Sarasota', 'Miami-Dade', 'Orange', 'Palm Beach', 'Fulton'],
    daysBack:         DAYS,
    maxRecords:       MAX,
    sarasotaDemoMode: true,
  });

  if (rawRecords.length === 0) {
    logger.warn('No records returned. Exiting.');
    process.exit(0);
  }

  // ── 2. Save raw snapshot ───────────────────────────────────────────────────
  const ts      = new Date().toISOString().slice(0, 10);
  const rawPath = path.join(config.output.directory, `raw_diamond_${ts}.json`);
  fs.mkdirSync(config.output.directory, { recursive: true });
  fs.writeFileSync(rawPath, JSON.stringify(rawRecords, null, 2));
  logger.info(`Raw snapshot → ${rawPath}  (${rawRecords.length} records)`);

  // ── 3. Process ─────────────────────────────────────────────────────────────
  const processor = new Processor(config);
  const { leads, stats } = await processor.run(rawRecords);

  // ── 3b. Sync to SaaS API & Supabase ────────────────────────────────────────
  await syncFLLeads(leads, `FL-${ts}`);
  if (typeof syncToSupabase === 'function') { await syncToSupabase(leads, `FL-${ts}`); }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── 4. Summary report ──────────────────────────────────────────────────────
  const LINE  = '━'.repeat(78);
  const line2 = '─'.repeat(78);

  console.log('\n');
  console.log('╔' + '═'.repeat(76) + '╗');
  console.log('║' + '  MULTIVENZA LEADHUNTER — DIAMOND LEADS REPORT'.padEnd(76) + '║');
  console.log('║' + `  ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET  |  Processed in ${elapsed}s`.padEnd(76) + '║');
  console.log('╚' + '═'.repeat(76) + '╝');
  console.log('');
  console.log(LINE);

  console.log(`  Raw records pulled    : ${stats.total}`);
  console.log(`  Qualified leads       : ${stats.passed}  (${Math.round(stats.passed / stats.total * 100)}% pass rate)`);
  console.log(`  Dropped               : ${stats.dropped}`);
  console.log('');
  console.log('  By category:');
  for (const [cat, count] of Object.entries(stats.byCategory)) {
    if (count > 0) {
      const pct = Math.round(count / stats.passed * 100);
      console.log(`    ${'  '+cat}`.padEnd(22) + `${count}  (${pct}%)`);
    }
  }
  console.log('');

  // Diamond breakdown
  const diamond = leads.filter(l =>
    l.flags.premium || l.flags.noGC ||
    l.flags.roofCritical || l.flags.highValue
  );
  const pure = leads.filter(l => l.score >= 70);

  console.log('  ◆ DIAMOND SIGNAL BREAKDOWN');
  console.log(`    Premium city (★)    : ${stats.premium.toString().padStart(4)}`);
  console.log(`    No-GC (★)          : ${stats.noGC.toString().padStart(4)}  (direct owner access)`);
  console.log(`    Roof critical (★)  : ${stats.roofCritical.toString().padStart(4)}  (15+ yr — insurer forcing replacement)`);
  console.log(`    Roof warm (★)      : ${stats.roofWarm.toString().padStart(4)}  (12–14 yr)`);
  console.log(`    High value >$50k   : ${leads.filter(l=>l.flags.highValue).length.toString().padStart(4)}`);
  console.log(`    Any diamond signal : ${diamond.length.toString().padStart(4)}`);
  console.log(`    Score ≥ 70 (pure ◆): ${pure.length.toString().padStart(4)}`);
  console.log('');
  console.log(`  📊 Total Project Value        : ${fmt$(stats.totalProjectValue)}`);
  console.log(`  📊 Est. Net Profit (30%)      : ${fmt$(stats.estNetProfitTotal)}`);
  console.log(`  💰 MultiVenza Partner Share   : ${fmt$(stats.partnerShareTotal)}  (35% of TPV)`);
  console.log(`  💰 Avg Partner Share / lead   : ${fmt$(stats.partnerShareTotal / Math.max(stats.passed, 1))}`);
  console.log(LINE);

  // ── 5. Top leads table ─────────────────────────────────────────────────────
  const topLeads = leads.slice(0, TOP);

  console.log(`\n  ◆ TOP ${TOP} DIAMOND LEADS  (sorted by score)\n`);
  console.log(
    '  ' +
    'Score'.padEnd(7) +
    'Bar'.padEnd(22) +
    'Tier'.padEnd(10) +
    'City'.padEnd(18) +
    'Category'.padEnd(14) +
    '  Signals'
  );
  console.log('  ' + line2);

  topLeads.forEach((l, i) => {
    const signals = [
      l.flags.premium      ? '★PREMIUM' : '',
      l.flags.noGC         ? '★NO-GC'   : '',
      l.flags.roofCritical ? '★ROOF15'  : '',
      l.flags.roofWarm     ? '~ROOF12'  : '',
      l.flags.highValue    ? '$HIGH'    : '',
    ].filter(Boolean).join(' ');

    console.log(
      `  ${String(i + 1).padStart(2)}. ` +
      String(l.score).padEnd(4) +
      bar(l.score).padEnd(22) +
      (l.tier === 'PREMIUM' ? '★ PREMIUM ' : 'STANDARD  ').padEnd(10) +
      (l.city || '').slice(0, 17).padEnd(18) +
      (l.category || '').padEnd(14) +
      '  ' + signals
    );
  });
  console.log('  ' + line2);

  // ── 6. Financial projection (top 10) ─────────────────────────────────────
  console.log('\n  💰 FINANCIAL PROJECTION — TOP 10\n');
  console.log(
    '  ' +
    '#'.padEnd(4) +
    'City'.padEnd(16) +
    'Category'.padEnd(14) +
    'Total Project Value'.padEnd(22) +
    'Net Profit 30%'.padEnd(18) +
    'Partner Share 35%'
  );
  console.log('  ' + line2);

  leads.slice(0, 10).forEach((l, i) => {
    console.log(
      '  ' +
      String(i + 1).padStart(2) + '.  ' +
      (l.city || '').padEnd(16) +
      (l.category || '').padEnd(14) +
      fmt$(l.projectValue.totalProjectValue).padEnd(22) +
      fmt$(l.projectValue.estNetProfit).padEnd(18) +
      fmt$(l.projectValue.partnerShare)
    );
  });
  console.log('  ' + line2);

  // ── 7. Output files list ──────────────────────────────────────────────────
  console.log('\n  📁 Output files:\n');
  const outputFiles = fs.readdirSync(config.output.directory)
    .filter(f => f.includes(ts))
    .sort();
  outputFiles.forEach(f => {
    const size = fs.statSync(path.join(config.output.directory, f)).size;
    const kb   = (size / 1024).toFixed(1);
    console.log(`     ${kb.padStart(7)} KB   ./output/${f}`);
  });

  console.log('');
  console.log(LINE);
  console.log(`  ✅  Run complete in ${elapsed}s  |  ${stats.passed} leads qualified  |  ${fmt$(stats.partnerShareTotal)} partner share pipeline`);
  console.log(LINE);
  console.log('');
}

main().catch(err => {
  logger.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
