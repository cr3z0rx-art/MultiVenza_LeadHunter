'use strict';

/**
 * index.js — MultiVenza LeadHunter Orchestrator
 *
 * Usage:
 *   node src/index.js                   # full pipeline (default)
 *   node src/index.js --mode=extract    # only run Apify extractor
 *   node src/index.js --mode=process    # process a saved raw JSON file
 *   node src/index.js --mode=audit      # CRM close audit only
 *   node src/index.js --mode=full       # extract → process → push → audit
 *
 * Environment variables (set in .env):
 *   APIFY_TOKEN
 *   CRM_PROVIDER       (generic | hubspot | gohighlevel)
 *   CRM_API_ENDPOINT
 *   CRM_API_KEY
 */

require('dotenv').config();

const fs        = require('fs');
const path      = require('path');
const config    = require('../config.json');
const Extractor = require('./extractor');
const Processor = require('./processor');
const CRMAuditor = require('./crm_auditor');
const Logger    = require('./utils/logger');

// Inject env vars into config at runtime
config.apify.token        = process.env.APIFY_TOKEN        || config.apify.token;
config.crm.apiEndpoint    = process.env.CRM_API_ENDPOINT   || config.crm.apiEndpoint;
config.crm.apiKey         = process.env.CRM_API_KEY        || config.crm.apiKey;
config.crm.provider       = process.env.CRM_PROVIDER       || config.crm.provider;

const logger = new Logger(config.logging);
const mode   = _parseMode();

async function main() {
  logger.separator('MultiVenza LeadHunter');
  logger.info(`Mode: ${mode} | Region: ${config.region.name}`);
  logger.info(`Counties: ${config.region.counties.join(', ')}`);

  switch (mode) {
    case 'extract':
      await runExtract();
      break;
    case 'process':
      await runProcess();
      break;
    case 'audit':
      await runAudit();
      break;
    case 'full':
    default:
      await runFull();
  }

  logger.separator('Done');
}

// ─── Pipeline stages ─────────────────────────────────────────────────────────

async function runExtract() {
  const extractor = new Extractor(config);
  const raw = await extractor.run();
  const outPath = _rawOutputPath();
  fs.writeFileSync(outPath, JSON.stringify(raw, null, 2));
  logger.info(`Raw records saved: ${outPath} (${raw.length} records)`);
  return raw;
}

async function runProcess(rawRecords = null) {
  if (!rawRecords) {
    const rawPath = _rawOutputPath();
    if (!fs.existsSync(rawPath)) {
      logger.error(`Raw data file not found: ${rawPath}. Run with --mode=extract first.`);
      process.exit(1);
    }
    rawRecords = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  }

  const processor = new Processor(config);
  const { leads, stats } = await processor.run(rawRecords);

  logger.info('Processing summary', stats);
  return { leads, stats };
}

async function runAudit() {
  const ts = new Date().toISOString().slice(0, 10);
  const leadsFile = path.join(
    config.output.directory,
    `${config.output.filePrefix}_all_${ts}.json`
  );

  if (!fs.existsSync(leadsFile)) {
    logger.error(`Leads file not found for today: ${leadsFile}. Run process step first.`);
    process.exit(1);
  }

  const auditor = new CRMAuditor(config);
  const leads   = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
  const pushStats = await auditor.pushLeads(leads);
  const report    = await auditor.auditCloses(leadsFile);

  logger.info('Audit summary', { pushStats, conversionRate: report.conversionRate });
  return report;
}

async function runFull() {
  // 1. Extract
  const raw = await runExtract();

  // 2. Process
  const { leads } = await runProcess(raw);

  // 3. Push to CRM + audit closes
  if (leads.length > 0) {
    const auditor = new CRMAuditor(config);
    const pushStats = await auditor.pushLeads(leads);
    logger.info('CRM push stats', pushStats);

    const ts = new Date().toISOString().slice(0, 10);
    const leadsFile = path.join(
      config.output.directory,
      `${config.output.filePrefix}_all_${ts}.json`
    );
    if (fs.existsSync(leadsFile)) {
      const report = await auditor.auditCloses(leadsFile);
      logger.info('Conversion rate this run', { rate: report.conversionRate });
    }
  } else {
    logger.warn('No qualified leads produced — CRM push skipped.');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _parseMode() {
  const modeArg = process.argv.find(a => a.startsWith('--mode='));
  if (!modeArg) return 'full';
  return modeArg.split('=')[1] || 'full';
}

function _rawOutputPath() {
  const ts = new Date().toISOString().slice(0, 10);
  return path.join(config.output.directory, `raw_permits_${ts}.json`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

main().catch(err => {
  logger.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
