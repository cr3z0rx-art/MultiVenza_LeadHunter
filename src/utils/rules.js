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

// ─── Urgency Skill ───────────────────────────────────────────────────────────

/**
 * Evalúa si un lead califica como URGENTE: Cierre en 7 días.
 *
 * Condiciones de urgencia:
 *   A) Roofing + techo > 18 años  → presión extrema de aseguradora, renovación inminente
 *   B) CGC + zona de inundación   → FEMA requiere elevación/refuerzo antes del próximo ciclo
 *   C) Cualquier categoría + permiso expirado + No-GC → propietario atascado sin ayuda
 *
 * @param {object} lead        - lead procesado (incluye category, roofAnalysis, flags, city)
 * @param {object} [opts]
 * @param {number} [opts.roofUrgencyAge=18] - umbral de edad de techo para urgencia máxima
 * @returns {{ urgent: boolean, level: 'HIGH'|'MEDIUM'|null, reason: string, salesNote: string }}
 */
function evaluateUrgency(lead, opts = {}) {
  const { roofUrgencyAge = 18 } = opts;

  const category  = lead.category  || '';
  const status    = (lead.status   || '').toUpperCase();
  const roofAge   = lead.roofAnalysis?.age || 0;
  const noGC      = lead.flags?.noGC || false;
  const isPremium = lead.flags?.premium || false;
  const city      = (lead.city || '').trim().toUpperCase();

  // Ciudades en zonas de inundación FEMA conocidas en FL West Coast
  const FLOOD_ZONE_CITIES = new Set([
    'SIESTA KEY', 'LONGBOAT KEY', 'LIDO KEY', 'ST. ARMANDS',
    'NOKOMIS', 'VENICE', 'PALMETTO',
  ]);

  let urgent = false;
  let level  = null;
  let reason = '';

  // Condición A: Roofing + techo > 18 años (urgencia máxima)
  if (category === 'roofing' && roofAge >= roofUrgencyAge) {
    urgent = true;
    level  = 'HIGH';
    reason = `Roofing — techo de ${roofAge} años (umbral urgencia: ${roofUrgencyAge} años). La aseguradora puede denegar renovación de póliza en el próximo ciclo.`;
  }

  // Condición B: CGC + ciudad en zona de inundación FEMA
  if (category === 'cgc' && FLOOD_ZONE_CITIES.has(city)) {
    urgent = true;
    level  = level === 'HIGH' ? 'HIGH' : 'HIGH';
    reason = reason
      ? reason + ` | CGC en zona de inundación FEMA (${lead.city}) — regulaciones de elevación activas.`
      : `CGC en zona de inundación FEMA (${lead.city}) — FEMA Flood Zone AE/VE, regulaciones de construcción estrictas con ventana de permiso limitada.`;
  }

  // Condición C: Permiso expirado + No-GC (propietario atascado)
  if (status === 'EXPIRED' && noGC) {
    urgent = true;
    level  = level || 'MEDIUM';
    reason = reason
      ? reason + ' | Permiso expirado — propietario sin contratista, proyecto detenido.'
      : 'Permiso expirado y sin contratista asignado. El propietario lleva tiempo buscando solución — alta probabilidad de cierre inmediato.';
  }

  if (!urgent) {
    return { urgent: false, level: null, reason: '', salesNote: '' };
  }

  // ── Generar nota de venta automática ────────────────────────────────────────
  const salesNote = _buildSalesNote(lead, reason, level, roofAge, isPremium);

  return { urgent, level, reason, salesNote };
}

/**
 * Genera la nota de venta lista para usar en llamada o mensaje de texto.
 * @private
 */
function _buildSalesNote(lead, reason, level, roofAge, isPremium) {
  const address  = [lead.address, lead.city, 'FL'].filter(Boolean).join(', ');
  const tpv      = lead.projectValue?.totalProjectValue || lead.valuation || 0;
  const category = lead.category || '';

  const premiumTag = isPremium ? ' (zona premium)' : '';
  const urgTag     = level === 'HIGH' ? '🔴 URGENTE' : '🟠 PRIORITARIO';

  let opener = '';
  let body   = '';
  let close  = '';

  if (category === 'roofing' && roofAge >= 18) {
    opener = `${urgTag} — Techo de ${roofAge} años en ${lead.city}${premiumTag}`;
    body   = [
      `Hola, le llamo respecto al permiso de re-techo en ${address}.`,
      `Revisamos los registros del condado y vemos que el techo tiene ${roofAge} años.`,
      `En Florida, Citizens Insurance y la mayoría de aseguradoras están exigiendo reemplazo`,
      `en propiedades con techos de más de 15 años. Si no lo reemplaza este año,`,
      `puede enfrentar cancelación o no-renovación de su póliza.`,
      `Nosotros podemos gestionar todo el proceso — permiso, materiales y mano de obra.`,
      `¿Tiene 5 minutos para hablar esta semana?`,
    ].join(' ');
    close = `Ventana de cierre estimada: 7 días. Valor del proyecto: $${tpv.toLocaleString('en-US')}.`;
  } else if (category === 'cgc') {
    opener = `${urgTag} — Renovación comercial en ${lead.city}${premiumTag}`;
    body   = [
      `Hola, encontramos su permiso de renovación en ${address}.`,
      `Vemos que el proyecto está activo pero sin contratista general asignado.`,
      `En zona costera de Florida, los permisos de obra tienen ventanas de actividad`,
      `estrictas. Podemos entrar como GC y gestionar el proyecto de inicio a fin,`,
      `cumpliendo con las normativas de zona de inundación y códigos de Miami-Dade.`,
      `¿Le interesa recibir una propuesta esta semana?`,
    ].join(' ');
    close = `Ventana de cierre estimada: 7 días. Valor del proyecto: $${tpv.toLocaleString('en-US')}.`;
  } else {
    opener = `${urgTag} — Permiso activo sin contratista en ${lead.city}${premiumTag}`;
    body   = [
      `Hola, encontramos su permiso de construcción en ${address}.`,
      `El permiso figura sin contratista asignado y queremos ayudarle a avanzar.`,
      `MultiVenza trabaja en proyectos de esta escala en toda la costa oeste de Florida.`,
      `¿Tiene tiempo para una llamada rápida?`,
    ].join(' ');
    close = `Ventana de cierre estimada: 7 días.`;
  }

  return [`## ${opener}`, '', body, '', `**${close}**`, '', `_Razón de urgencia: ${reason}_`].join('\n');
}

module.exports = {
  isNoGC,
  calcRoofAge,
  classifyRoofAge,
  applyRoofAgeRule,
  detectCategory,
  isCGCLicense,
  evaluateUrgency,
};
