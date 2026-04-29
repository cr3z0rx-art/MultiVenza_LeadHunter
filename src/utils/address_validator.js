'use strict';

/**
 * src/utils/address_validator.js
 *
 * Validación y normalización ligera de direcciones para FL West Coast.
 * No requiere llamadas a API — usa tablas locales de calles conocidas.
 *
 * Tres niveles de resultado:
 *   VALID           — calle conocida para esa ciudad, ZIP correcto
 *   CORRECTED       — calle normalizada con corrección conocida
 *   UNVERIFIED      — calle no reconocida para esa ciudad → etiqueta [DIRECCIÓN POR VERIFICAR]
 */

// ─── Calles reales conocidas por ciudad ──────────────────────────────────────
// Fuente: datos reales de condados Sarasota y Hillsborough

const KNOWN_STREETS = {
  'SIESTA KEY': [
    'OCEAN BLVD', 'BEACH RD', 'GULF DR', 'MIDNIGHT PASS RD',
    'POINT OF ROCKS RD', 'HIGEL AVE', 'SIESTA DR', 'CRESCENT ST',
    'AVENIDA DE MAYO', 'HARDING ST', 'CALLE MIRAMAR', 'PEACOCK RD',
    'LAGUNA DR', 'CANAL RD', 'NORA DR', 'CECILIA CT',
  ],
  'LONGBOAT KEY': [
    'GULF OF MEXICO DR', 'BAY ISLES RD', 'LONGBOAT CLUB RD',
    'HARBOUR DR', 'BAYFRONT DR', 'SEABREEZE DR', 'BAYOU DR',
    'BROADWAY ST', 'ARECA AVE', 'PALM DR',
  ],
  'LAKEWOOD RANCH': [
    'UNIVERSITY PKWY', 'LORRAINE RD', 'LAKEWOOD RANCH BLVD',
    'PROFESSIONAL PKWY', 'WATERSIDE DR', 'MAIN ST', 'RANGELAND PKWY',
    'BOURNESIDE BLVD', 'GRAND PARK BLVD', 'UIHLEIN RD',
    'SHORELINE DR', 'PALM AVE', 'WHISPERING OAKS WAY',
  ],
  'TAMPA': null,   // Tampa: Hillsborough data es real → no validar por tabla
};

// ─── Correcciones conocidas (calle demo → calle real aproximada) ──────────────
// Agregar aquí cuando el socio reporta una corrección confirmada en Google Maps.

const CORRECTIONS = {
  'SIESTA KEY': {
    'BAY BLVD':        'Midnight Pass Rd',   // Bay Blvd no existe en Siesta Key
    'BAYSIDE DR':      'Crescent St',
    'GULF BLVD':       'Ocean Blvd',
  },
  'LONGBOAT KEY': {
    'GULF DR':         'Gulf of Mexico Dr',
    'BAY BLVD':        'Bayfront Dr',
  },
  'LAKEWOOD RANCH': {
    'GULF DR':         null,   // Gulf Dr no existe en Lakewood Ranch (landlocked)
    'BEACH RD':        null,   // Beach Rd no existe en Lakewood Ranch
    'BAY BLVD':        null,
  },
};

// ─── ZIPs válidos por ciudad ──────────────────────────────────────────────────

const VALID_ZIPS = {
  'SIESTA KEY':     ['34242'],
  'LONGBOAT KEY':   ['34228'],
  'LAKEWOOD RANCH': ['34202', '34211', '34212', '34240'],
  'TAMPA':          ['33601','33602','33603','33604','33605','33606','33607',
                     '33608','33609','33610','33611','33612','33613','33614',
                     '33615','33616','33617','33618','33619','33620','33621',
                     '33622','33623','33624','33625','33626','33629','33634',
                     '33635','33637','33647'],
  'BRADENTON':      ['34201','34202','34203','34205','34206','34207','34208',
                     '34209','34210','34211'],
  'SARASOTA':       ['34230','34231','34232','34233','34234','34235','34236',
                     '34237','34238','34239','34241','34242','34243'],
  'VENICE':         ['34285','34286','34287','34292','34293'],
  'NOKOMIS':        ['34275'],
  'NORTH PORT':     ['34286','34287','34288','34289','34291'],
};

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Valida y normaliza una dirección.
 *
 * @param {string} address  - calle y número ("1272 Bay Blvd")
 * @param {string} city     - ciudad ("Siesta Key")
 * @param {string} zip      - ZIP ("34242")
 *
 * @returns {{
 *   normalizedAddress: string,   // dirección limpia lista para Google Maps
 *   status: 'VALID'|'CORRECTED'|'UNVERIFIED',
 *   tag: string|null,            // '[DIRECCIÓN POR VERIFICAR]' si UNVERIFIED
 *   note: string,                // explicación corta
 * }}
 */
function validateAddress(address, city, zip) {
  const cityUpper = (city || '').toUpperCase().trim();
  const addrUpper = (address || '').toUpperCase().trim();
  const zipStr    = (zip || '').trim();

  // Ciudades sin tabla (Tampa = datos reales ArcGIS) → siempre VALID
  if (KNOWN_STREETS[cityUpper] === null) {
    return {
      normalizedAddress: _format(address, city, zipStr),
      status: 'VALID',
      tag:    null,
      note:   'Hillsborough (ArcGIS live data)',
    };
  }

  // Ciudades no listadas → pasar sin validar
  if (!KNOWN_STREETS[cityUpper]) {
    return {
      normalizedAddress: _format(address, city, zipStr),
      status: 'VALID',
      tag:    null,
      note:   '',
    };
  }

  // ── Validar ZIP ──────────────────────────────────────────────────────────
  const validZips = VALID_ZIPS[cityUpper] || [];
  const zipOk     = !zipStr || validZips.length === 0 || validZips.includes(zipStr);

  // ── Extraer nombre de calle (sin número) ────────────────────────────────
  const streetName = _extractStreetName(addrUpper);

  // ── Verificar correcciones conocidas ────────────────────────────────────
  const corrections = CORRECTIONS[cityUpper] || {};
  if (corrections[streetName] !== undefined) {
    const fix = corrections[streetName];
    if (fix === null) {
      // Calle definitivamente errónea, sin corrección disponible
      const num  = _extractNumber(address);
      const note = `Calle "${_toTitleCase(streetName)}" no existe en ${city} — dirección de datos demo`;
      return {
        normalizedAddress: _format(address, city, zipStr) + ' [DIRECCIÓN POR VERIFICAR]',
        status: 'UNVERIFIED',
        tag:    '[DIRECCIÓN POR VERIFICAR]',
        note,
      };
    }
    // Corrección disponible
    const num       = _extractNumber(address);
    const corrected = num ? `${num} ${fix}` : fix;
    return {
      normalizedAddress: _format(corrected, city, zipStr),
      status: 'CORRECTED',
      tag:    null,
      note:   `Normalizado: "${_toTitleCase(streetName)}" → "${fix}"`,
    };
  }

  // ── Verificar contra tabla de calles conocidas ───────────────────────────
  const knownStreets = KNOWN_STREETS[cityUpper] || [];
  const isKnown = knownStreets.some(s => addrUpper.includes(s));

  if (!isKnown) {
    return {
      normalizedAddress: _format(address, city, zipStr) + ' [DIRECCIÓN POR VERIFICAR]',
      status: 'UNVERIFIED',
      tag:    '[DIRECCIÓN POR VERIFICAR]',
      note:   `Calle no reconocida en tabla de ${city} — verificar en sc-pa.com`,
    };
  }

  // ── ZIP inválido ─────────────────────────────────────────────────────────
  if (!zipOk) {
    return {
      normalizedAddress: _format(address, city, zipStr) + ' [DIRECCIÓN POR VERIFICAR]',
      status: 'UNVERIFIED',
      tag:    '[DIRECCIÓN POR VERIFICAR]',
      note:   `ZIP ${zipStr} no corresponde a ${city} (esperado: ${validZips.join(', ')})`,
    };
  }

  return {
    normalizedAddress: _format(address, city, zipStr),
    status: 'VALID',
    tag:    null,
    note:   '',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _format(address, city, zip) {
  const parts = [address.trim(), city.trim(), 'FL'];
  if (zip) parts.push(zip.trim());
  return parts.join(', ');
}

function _extractNumber(address) {
  const m = (address || '').match(/^\d+/);
  return m ? m[0] : '';
}

function _extractStreetName(addrUpper) {
  // Remove leading number to get street name
  return addrUpper.replace(/^\d+\s+/, '').trim();
}

function _toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { validateAddress };
