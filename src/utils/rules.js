'use strict';

/**
 * Business rules engine for Florida West Coast LeadHunter.
 *
 * Rule 1 — No-GC Detection:
 *   Permits where no licensed General Contractor is attached are higher-value
 *   leads because there is no GC acting as gatekeeper. The property owner
 *   is the direct decision-maker.
 *
 * Rule 2 — 15-Year Roof Rule:
 *   Florida insurers routinely refuse to renew or require replacement of roofs
 *   that are 15+ years old. Homeowners in this bracket face urgent financial
 *   pressure to replace, making them the hottest roofing leads.
 *   12–14 year roofs are "warm" — worth working now before competitors do.
 */

const dayjs = require('dayjs');

// ─── No-GC Rule ──────────────────────────────────────────────────────────────

const NO_GC_IDENTIFIERS = new Set([
  'OWNER BUILDER',
  'OWNER-BUILDER',
  'NO GC',
  'SELF',
  'HOMEOWNER',
  'NONE',
  '',
  null,
  undefined,
]);

/**
 * Returns true when the permit has no General Contractor attached.
 * @param {string|null} contractorName - Raw contractor field from permit data
 * @returns {boolean}
 */
function isNoGC(contractorName) {
  if (contractorName === null || contractorName === undefined) return true;
  const normalized = String(contractorName).trim().toUpperCase();
  return NO_GC_IDENTIFIERS.has(normalized);
}

// ─── 15-Year Roof Rule ────────────────────────────────────────────────────────

/**
 * Calculates the age of a roof in years from a given date string or Date.
 * Falls back to null if the date cannot be parsed.
 * @param {string|Date|null} roofDate
 * @returns {number|null}
 */
function calcRoofAge(roofDate) {
  if (!roofDate) return null;
  const parsed = dayjs(roofDate);
  if (!parsed.isValid()) return null;
  return dayjs().diff(parsed, 'year');
}

/**
 * Classifies a roof's urgency based on the 15-Year Rule.
 * @param {number|null} ageYears
 * @returns {'critical'|'warm'|'none'|'unknown'}
 */
function classifyRoofAge(ageYears) {
  if (ageYears === null) return 'unknown';
  if (ageYears >= 15) return 'critical';   // Insurer likely requiring replacement
  if (ageYears >= 12) return 'warm';       // Getting close — pre-empt competitors
  return 'none';
}

/**
 * Full roof rule evaluation for a lead record.
 * @param {object} lead - Must include roofYear or permitDate
 * @param {object} ruleConfig - config.filters.roofAgeRule
 * @returns {{ age: number|null, classification: string, flag: boolean, score: number }}
 */
function applyRoofAgeRule(lead, ruleConfig) {
  const { thresholdYears = 15, warningYears = 12, boostScore = 50 } = ruleConfig || {};

  // Prefer an explicit roofYear; fall back to permit date for roofing permits
  const dateSource = lead.roofYear || lead.permitDate || null;
  const age = calcRoofAge(dateSource);
  const classification = classifyRoofAge(age);

  let score = 0;
  if (classification === 'critical') score = boostScore;
  else if (classification === 'warm') score = Math.round(boostScore * 0.5);

  return {
    age,
    ageSource: dateSource,
    classification,
    flag: classification === 'critical' || classification === 'warm',
    score,
    note: buildRoofNote(classification, age, thresholdYears, warningYears),
  };
}

function buildRoofNote(classification, age, threshold, warning) {
  if (classification === 'critical')
    return `Roof is ${age} years old — exceeds ${threshold}-year insurance threshold. URGENT replacement lead.`;
  if (classification === 'warm')
    return `Roof is ${age} years old — approaching ${threshold}-year threshold (warn at ${warning} yrs). Warm lead.`;
  if (classification === 'unknown')
    return 'Roof age unknown — manual verification recommended.';
  return '';
}

// ─── Permit Category Detection ───────────────────────────────────────────────

/**
 * Detects which lead category (roofing / cgc / homeBuilders) a permit belongs to.
 * Returns the first matching category name or null.
 * @param {string} permitDescription
 * @param {object} categoryConfig - config.leadCategories
 * @returns {string|null}
 */
function detectCategory(permitDescription, categoryConfig) {
  if (!permitDescription) return null;
  const upper = String(permitDescription).toUpperCase();

  for (const [categoryName, cat] of Object.entries(categoryConfig)) {
    if (!cat.enabled) continue;
    const matched = cat.permitKeywords.some(kw => upper.includes(kw.toUpperCase()));
    if (matched) return categoryName;
  }
  return null;
}

// ─── CGC License Validation ───────────────────────────────────────────────────

/**
 * Checks if a license number matches the Florida CGC prefix pattern.
 * @param {string|null} licenseNumber
 * @returns {boolean}
 */
function isCGCLicense(licenseNumber) {
  if (!licenseNumber) return false;
  return /^CGC\d+$/i.test(String(licenseNumber).trim());
}

module.exports = {
  isNoGC,
  calcRoofAge,
  classifyRoofAge,
  applyRoofAgeRule,
  detectCategory,
  isCGCLicense,
};
