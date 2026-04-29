'use strict';

/**
 * src/utils/financials.js
 *
 * Fuente ÚNICA de verdad para el modelo financiero MultiVenza LeadHunter.
 *
 * Constantes de negocio (v3.0 — GA Market Realism):
 *   - FL Net Profit Rate : 35% uniforme, piso PREMIUM $250k en ciudades premium
 *   - GA Contract Mult.  : 1.3× sobre valuación declarada (gap declarado vs. real)
 *   - GA Profit by Niche : ROOFING/SOLAR 40% · COMMERCIAL/NEW CONST 25%
 *                          REMODELING/BASEMENT/ADDITION 32% · OTHER 30%
 *   - IL Net Profit Rate : 35% uniforme
 *   - Golden Rule        : FL >= $10k · GA >= $15k · IL >= $15k
 *
 * Equivalente Python: scripts/financials.py — sincronizar cambios en ambos archivos.
 */

// ─── Constantes de negocio ────────────────────────────────────────────────────

const NET_PROFIT_RATE_FL_IL = 0.35;
const PREMIUM_FLOOR = 250_000;

// GA: el valor declarado al condado es solo materiales — el contrato real es ~30% mayor
const GA_CONTRACT_MULTIPLIER = 1.3;

const GA_NICHE_PROFIT_RATES = {
    ROOFING:          0.40,
    SOLAR:            0.40,
    COMMERCIAL:       0.25,
    NEW_CONSTRUCTION: 0.25,
    REMODELING:       0.32,
    BASEMENT:         0.32,
    ADDITION:         0.32,
};
const GA_DEFAULT_PROFIT_RATE = 0.30;

const PREMIUM_CITIES = {
    FL: new Set(['SIESTA KEY', 'LONGBOAT KEY', 'LAKEWOOD RANCH']),
    GA: new Set(),
    IL: new Set(),
};

const GOLDEN_RULE_THRESHOLDS = {
    FL: 10_000,
    GA: 15_000,
    IL: 15_000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeCity(city) {
    if (!city) return '';
    return String(city).trim().toUpperCase();
}

function normalizeState(state) {
    if (!state) return '';
    return String(state).trim().toUpperCase();
}

// ─── Detección de nicho (GA) ──────────────────────────────────────────────────

const NICHE_KEYWORDS = {
    ROOFING:          ['ROOF', 'REROOF', 'RE-ROOF', 'SHINGLE', 'TILE ROOF', 'FLAT ROOF'],
    SOLAR:            ['SOLAR', 'PHOTOVOLTAIC', 'PV SYSTEM', 'PV PANEL'],
    NEW_CONSTRUCTION: ['NEW CONSTRUCTION', 'NEW BUILD', 'NEW SINGLE FAMILY', 'NEW HOME',
                       'SFD NEW', 'NEW RESIDENCE', 'NEW DWELLING'],
    COMMERCIAL:       ['COMMERCIAL', 'RETAIL', 'OFFICE', 'WAREHOUSE', 'MIXED USE',
                       'TENANT IMPROVEMENT'],
    BASEMENT:         ['BASEMENT', 'BASEMENT FINISH', 'BASEMENT COMPLETION'],
    ADDITION:         ['ADDITION', 'ADDTN', 'ROOM ADDITION', 'GARAGE ADDITION'],
    REMODELING:       ['REMODEL', 'RENOVATION', 'INTERIOR ALT', 'ALTERATION',
                       'KITCHEN', 'BATHROOM'],
};

/**
 * Detecta la categoría de nicho a partir del tipo de permiso y descripción.
 * @param {string} permitType
 * @param {string} description
 * @returns {string} ROOFING | SOLAR | COMMERCIAL | NEW_CONSTRUCTION | REMODELING | BASEMENT | ADDITION | OTHER
 */
function detectNicheCategory(permitType = '', description = '') {
    const text = `${permitType} ${description}`.toUpperCase();
    for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
        if (keywords.some(kw => text.includes(kw))) return niche;
    }
    return 'OTHER';
}

function getGaNicheRate(nicheCategory) {
    return GA_NICHE_PROFIT_RATES[nicheCategory] ?? GA_DEFAULT_PROFIT_RATE;
}

// ─── API pública ──────────────────────────────────────────────────────────────

function isPremiumCity(state, city) {
    const s = normalizeState(state);
    const c = normalizeCity(city);
    if (!s || !c) return false;
    const set = Object.prototype.hasOwnProperty.call(PREMIUM_CITIES, s) ? PREMIUM_CITIES[s] : null;
    return set ? set.has(c) : false;
}

function getGoldenRuleThreshold(state) {
    const s = normalizeState(state);
    return Object.prototype.hasOwnProperty.call(GOLDEN_RULE_THRESHOLDS, s)
        ? GOLDEN_RULE_THRESHOLDS[s]
        : 0;
}

function passesGoldenRule(valuation, state) {
    const threshold = getGoldenRuleThreshold(state);
    const val = Number(valuation) || 0;
    return val >= threshold;
}

/**
 * Calcula el modelo financiero completo de un lead.
 *
 * GA: TPV = valuation × 1.3 · Net Profit = TPV × tasa_de_nicho
 * FL: TPV = max(valuation, $250k) en PREMIUM · Net Profit = TPV × 35%
 * IL: TPV = valuation · Net Profit = TPV × 35%
 *
 * @param {object} params
 * @param {number} params.valuation
 * @param {string} params.state
 * @param {string} [params.city]
 * @param {string} [params.permitType]
 * @param {string} [params.description]
 */
function calculateFinancials({ valuation, state, city = '', permitType = '', description = '' }) {
    const val = Math.max(0, Number(valuation) || 0);
    const s = normalizeState(state);

    let tpv, nicheCategory, nicheRate, floorApplied, contractMultiplierApplied, tier, marketNote;

    if (s === 'GA') {
        nicheCategory = detectNicheCategory(permitType, description);
        nicheRate = getGaNicheRate(nicheCategory);
        tpv = Math.round(val * GA_CONTRACT_MULTIPLIER * 100) / 100;
        contractMultiplierApplied = true;
        floorApplied = false;
        tier = 'STANDARD';
        marketNote = `GA: valuación declarada $${val.toLocaleString('en-US')} × ${GA_CONTRACT_MULTIPLIER} = TPV $${tpv.toLocaleString('en-US')} | Nicho ${nicheCategory} @ ${Math.round(nicheRate * 100)}%`;
    } else {
        nicheCategory = 'N/A';
        nicheRate = NET_PROFIT_RATE_FL_IL;
        contractMultiplierApplied = false;
        const premium = isPremiumCity(s, city);
        tier = premium ? 'PREMIUM' : 'STANDARD';
        floorApplied = premium && val < PREMIUM_FLOOR;
        tpv = floorApplied ? PREMIUM_FLOOR : val;
        marketNote = floorApplied
            ? `Piso PREMIUM aplicado (${s}): valor declarado $${val.toLocaleString('en-US')} → $${PREMIUM_FLOOR.toLocaleString('en-US')}`
            : '';
    }

    const netProfit = Math.round(tpv * nicheRate * 100) / 100;

    return {
        tier,
        tpv,
        netProfit,
        // backward compat alias
        netProfit35: netProfit,
        nicheCategory,
        nicheRate,
        floorApplied,
        contractMultiplierApplied,
        marketNote,
        rate: nicheRate,
        threshold: getGoldenRuleThreshold(s),
        passesGoldenRule: passesGoldenRule(val, s),
    };
}

module.exports = {
    // Constantes
    NET_PROFIT_RATE_FL_IL,
    PREMIUM_FLOOR,
    GA_CONTRACT_MULTIPLIER,
    GA_NICHE_PROFIT_RATES,
    GA_DEFAULT_PROFIT_RATE,
    PREMIUM_CITIES,
    GOLDEN_RULE_THRESHOLDS,

    // Funciones
    isPremiumCity,
    getGoldenRuleThreshold,
    passesGoldenRule,
    detectNicheCategory,
    getGaNicheRate,
    calculateFinancials,

    // Helpers
    normalizeCity,
    normalizeState,
};
