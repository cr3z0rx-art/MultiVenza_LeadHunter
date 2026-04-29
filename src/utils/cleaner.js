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

module.exports = {
  cleanName,
  cleanAddress
};
