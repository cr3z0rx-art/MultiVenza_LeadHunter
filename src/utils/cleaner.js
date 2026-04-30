'use strict';

/**
 * src/utils/cleaner.js
 * Módulo para la limpieza y normalización de nombres y direcciones.
 */

/**
 * Convierte un nombre a Title Case, manejando casos especiales de Florida (LLC, INC, etc).
 * @param {string} name 
 * @returns {string}
 */
function cleanName(name) {
  if (!name) return '';
  
  // 1. Limpiar espacios extra y mayúsculas
  let cleaned = name.trim().toUpperCase();

  // 2. Manejo de sufijos comunes (asegurar que sean siempre UPPERCASE y sin puntos extras)
  const suffixes = [' LLC', ' INC', ' CORP', ' TRUST', ' ESTATE', ' LTD', ' PLLC'];
  suffixes.forEach(suffix => {
    if (cleaned.endsWith(suffix.replace(' ', '')) || cleaned.endsWith(suffix)) {
      // Dejar el sufijo al final y procesar el resto
    }
  });

  // 3. Convertir a Title Case
  cleaned = cleaned.toLowerCase().split(' ').map(word => {
    if (word.length === 0) return '';
    // Excepciones que deben ir en UPPERCASE
    if (['llc', 'inc', 'corp', 'p.a.', 'pa', 'trust', 'ltd'].includes(word.replace(/[^a-z]/g, ''))) {
      return word.toUpperCase();
    }
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');

  return cleaned.trim();
}

/**
 * Normaliza la dirección para visualización premium.
 * @param {string} address 
 * @returns {string}
 */
function cleanAddress(address) {
  if (!address) return '';
  return address.trim().toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\bAVE\b/g, 'Ave')
    .replace(/\bBLVD\b/g, 'Blvd')
    .replace(/\bST\b/g, 'St')
    .replace(/\bRD\b/g, 'Rd')
    .replace(/\bDR\b/g, 'Dr')
    .replace(/\bLN\b/g, 'Ln')
    .replace(/\bCT\b/g, 'Ct')
    .replace(/\bPKWY\b/g, 'Pkwy')
    .replace(/\bHWY\b/g, 'Hwy');
}

/**
 * Normaliza la dirección según los estándares postales USPS (ALL CAPS, sin puntuación).
 * @param {string} address 
 * @returns {string}
 */
function standardizeUSPS(address) {
  if (!address) return '';
  return address.trim().toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bCOURT\b/g, 'CT')
    .replace(/\bPARKWAY\b/g, 'PKWY')
    .replace(/\bHIGHWAY\b/g, 'HWY')
    .replace(/\bCIRCLE\b/g, 'CIR')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\bTERRACE\b/g, 'TER')
    .replace(/\bTRAIL\b/g, 'TRL')
    .replace(/\bNORTH\b/g, 'N')
    .replace(/\bSOUTH\b/g, 'S')
    .replace(/\bEAST\b/g, 'E')
    .replace(/\bWEST\b/g, 'W')
    .replace(/[.,]/g, ''); // Sin puntuación
}

/**
 * Separa el nombre limpio en First Name y Last Name.
 */
function splitName(cleanedName) {
  if (!cleanedName) return { firstName: '', lastName: '' };
  const upper = cleanedName.toUpperCase();
  const companySuffixes = [' LLC', ' INC', ' CORP', ' TRUST', ' ESTATE', ' LTD', ' PLLC', ' PA'];
  const isCompany = companySuffixes.some(s => upper.endsWith(s) || upper.includes('COMPANY') || upper.includes('BUILDER'));
  
  if (isCompany) return { firstName: cleanedName, lastName: '' };

  const parts = cleanedName.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  
  const lastName = parts.pop();
  const firstName = parts.join(' ');
  return { firstName, lastName };
}

module.exports = {
  cleanName,
  cleanAddress,
  standardizeUSPS,
  splitName
};
