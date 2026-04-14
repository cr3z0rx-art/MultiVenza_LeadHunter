'use strict';

/**
 * zillow_comparator.js
 * Compara el Total Project Value de cada lead contra el precio mediano
 * de venta en la misma calle/zona y marca los leads subestimados.
 *
 * Modo 1 (LIVE) — requiere ZILLOW_API_KEY en .env:
 *   Usa Zillow Bridge API / RentCast API para obtener el valor estimado
 *   de la propiedad por dirección.
 *
 * Modo 2 (FALLBACK) — sin API key:
 *   Usa los pisos de valoración de mercado documentados por zona.
 *   Fuente: Sarasota County Property Appraiser + Hillsborough HCPAFL.
 *
 * Un lead se marca como SUBESTIMADO cuando:
 *   TPV < (mediana de zona × UNDERVALUE_THRESHOLD)
 *
 * Uso:
 *   const { enrichWithZillow } = require('./utils/zillow_comparator');
 *   const enriched = await enrichWithZillow(leads);
 */

const https = require('https');

// ─── Pisos de mercado por ciudad (fallback sin API) ───────────────────────────
// Fuente: Sarasota County Property Appraiser + Zillow mediana 2025-2026
const MARKET_FLOORS = {
  'SIESTA KEY':      { medianSalePrice: 850000,  medianRoofJob: 35000,  medianNewConstruction: 600000 },
  'LONGBOAT KEY':    { medianSalePrice: 1200000, medianRoofJob: 45000,  medianNewConstruction: 900000 },
  'LAKEWOOD RANCH':  { medianSalePrice: 520000,  medianRoofJob: 22000,  medianNewConstruction: 420000 },
  'LIDO KEY':        { medianSalePrice: 950000,  medianRoofJob: 40000,  medianNewConstruction: 700000 },
  'ST. ARMANDS':     { medianSalePrice: 750000,  medianRoofJob: 30000,  medianNewConstruction: 550000 },
  'VENICE':          { medianSalePrice: 380000,  medianRoofJob: 16000,  medianNewConstruction: 310000 },
  'NOKOMIS':         { medianSalePrice: 360000,  medianRoofJob: 14000,  medianNewConstruction: 290000 },
  'NORTH PORT':      { medianSalePrice: 310000,  medianRoofJob: 14000,  medianNewConstruction: 275000 },
  'BRADENTON':       { medianSalePrice: 340000,  medianRoofJob: 15000,  medianNewConstruction: 300000 },
  'PALMETTO':        { medianSalePrice: 300000,  medianRoofJob: 13000,  medianNewConstruction: 260000 },
  'LAUREL':          { medianSalePrice: 290000,  medianRoofJob: 13000,  medianNewConstruction: 250000 },
  'TAMPA':           { medianSalePrice: 380000,  medianRoofJob: 16000,  medianNewConstruction: 320000 },
  'ST. PETERSBURG':  { medianSalePrice: 420000,  medianRoofJob: 18000,  medianNewConstruction: 360000 },
  'PORT CHARLOTTE':  { medianSalePrice: 280000,  medianRoofJob: 12000,  medianNewConstruction: 240000 },
  'PUNTA GORDA':     { medianSalePrice: 320000,  medianRoofJob: 14000,  medianNewConstruction: 280000 },
};

// Un lead es SUBESTIMADO si su TPV está por debajo del X% de la mediana del mercado
const UNDERVALUE_THRESHOLD = 0.60;  // < 60% del precio mediano de la zona = subestimado

// ─── Zillow / RentCast API (live, requiere API key) ───────────────────────────

async function _fetchZillowEstimate(address, city, zip, apiKey) {
  // RentCast API — accesible con plan básico (~$50/mes)
  // Alternativa: Zillow Bridge API (requiere partner agreement)
  const encoded = encodeURIComponent(`${address}, ${city}, FL ${zip}`);
  const url = `https://api.rentcast.io/v1/properties?address=${encoded}&limit=1`;

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.rentcast.io',
      path:     `/v1/properties?address=${encoded}&limit=1`,
      headers:  { 'X-Api-Key': apiKey },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          const prop = Array.isArray(body) ? body[0] : body;
          resolve({
            estimatedValue: prop?.price || prop?.lastSalePrice || null,
            source: 'RentCast API',
          });
        } catch {
          resolve({ estimatedValue: null, source: 'RentCast API (parse error)' });
        }
      });
    });
    req.on('error', () => resolve({ estimatedValue: null, source: 'RentCast API (network error)' }));
    req.end();
  });
}

// ─── Comparador por zona (fallback) ──────────────────────────────────────────

function _getMarketReference(city, category) {
  const key    = (city || '').trim().toUpperCase();
  const floors = MARKET_FLOORS[key];
  if (!floors) return null;

  if (category === 'roofing')      return floors.medianRoofJob;
  if (category === 'homeBuilders') return floors.medianNewConstruction;
  return floors.medianNewConstruction;  // cgc y otros
}

// ─── Enriquecedor principal ───────────────────────────────────────────────────

/**
 * Añade la propiedad `zillowComparison` a cada lead.
 *
 * @param {object[]} leads       - array de leads procesados
 * @param {object}   opts
 * @param {string}   opts.apiKey - RENTCAST_API_KEY o ZILLOW_API_KEY (opcional)
 * @param {boolean}  opts.live   - true = llamar a la API; false = solo fallback local
 * @returns {Promise<object[]>}  - leads con zillowComparison añadido
 */
async function enrichWithZillow(leads, opts = {}) {
  const apiKey = opts.apiKey || process.env.RENTCAST_API_KEY || process.env.ZILLOW_API_KEY || '';
  const useLive = opts.live && !!apiKey;

  const enriched = [];

  for (const lead of leads) {
    const tpv      = (lead.projectValue || {}).totalProjectValue || lead.valuation || 0;
    const city     = lead.city || '';
    const category = lead.category || '';

    let marketRef    = null;
    let marketSource = '';

    if (useLive) {
      const result = await _fetchZillowEstimate(lead.address, city, lead.zip, apiKey);
      marketRef    = result.estimatedValue;
      marketSource = result.source;
    }

    // Fallback a tabla local si la API no devuelve dato
    if (!marketRef) {
      marketRef    = _getMarketReference(city, category);
      marketSource = 'MultiVenza Market Reference Table (2025–2026)';
    }

    let zillowComparison;

    if (!marketRef) {
      zillowComparison = {
        marketReference: null,
        marketSource:    'Sin datos de mercado para esta zona',
        ratio:           null,
        flag:            'UNKNOWN',
        note:            'Ciudad no encontrada en tabla de referencia de mercado.',
      };
    } else {
      const ratio       = tpv / marketRef;
      const isUnderval  = ratio < UNDERVALUE_THRESHOLD;
      const pct         = Math.round(ratio * 100);

      zillowComparison = {
        marketReference: marketRef,
        marketSource,
        tpv,
        ratio:           Math.round(ratio * 100) / 100,
        flag:            isUnderval ? 'SUBESTIMADO' : 'OK',
        note:            isUnderval
          ? `TPV $${tpv.toLocaleString()} es ${pct}% del precio de mercado ($${marketRef.toLocaleString()}) — posible sub-declaración. Recalcular con Property Appraiser.`
          : `TPV $${tpv.toLocaleString()} es ${pct}% del precio de referencia de mercado ($${marketRef.toLocaleString()}).`,
      };
    }

    enriched.push({ ...lead, zillowComparison });
  }

  return enriched;
}

// ─── Resumen de subestimados ──────────────────────────────────────────────────

function summaryUndervalued(enrichedLeads) {
  const undervalued = enrichedLeads.filter(l => l.zillowComparison?.flag === 'SUBESTIMADO');
  return {
    total:       enrichedLeads.length,
    undervalued: undervalued.length,
    ok:          enrichedLeads.length - undervalued.length,
    leads:       undervalued.map(l => ({
      leadId:  l.leadId,
      address: l.address,
      city:    l.city,
      tpv:     l.projectValue?.totalProjectValue,
      ref:     l.zillowComparison.marketReference,
      ratio:   l.zillowComparison.ratio,
      note:    l.zillowComparison.note,
    })),
  };
}

module.exports = { enrichWithZillow, summaryUndervalued, MARKET_FLOORS };
