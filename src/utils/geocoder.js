'use strict';

const https = require('https');

/**
 * src/utils/geocoder.js
 * Módulo para validación de direcciones usando Google Maps Geocoding API.
 */

class Geocoder {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'maps.googleapis.com';
  }

  /**
   * Geocodifica una dirección para verificar su existencia real.
   * @param {string} address 
   * @param {string} city 
   * @param {string} zip 
   * @returns {Promise<object|null>}
   */
  async geocode(address, city, zip) {
    if (!this.apiKey) return null;

    const query = `${address}, ${city}, FL ${zip || ''}`;
    const path = `/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${this.apiKey}`;

    return new Promise((resolve) => {
      const options = {
        hostname: this.baseUrl,
        path,
        method: 'GET',
      };

      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            if (body.status === 'OK' && body.results && body.results.length > 0) {
              const result = body.results[0];
              // Verificar si el match es exacto o aproximado
              resolve({
                formattedAddress: result.formatted_address,
                location: result.geometry.location,
                types: result.types,
                partialMatch: body.results.length > 1 || !!result.partial_match,
                placeId: result.place_id
              });
            } else {
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.setTimeout(5000, () => { req.destroy(); resolve(null); });
      req.end();
    });
  }
}

module.exports = Geocoder;
