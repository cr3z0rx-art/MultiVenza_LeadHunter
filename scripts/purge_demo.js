'use strict';
require('dotenv').config();
const https = require('https');
const { URL } = require('url');

const SAAS_API_URL = (process.env.SAAS_API_URL || '').replace(/\/$/, '');
const SAAS_API_KEY = process.env.SAAS_API_KEY || '';

async function purge() {
  if (!SAAS_API_URL || !SAAS_API_KEY) {
    console.error('❌ Error: SAAS_API_URL o SAAS_API_KEY no configurados');
    process.exit(1);
  }

  const url = `${SAAS_API_URL}/api/sync`;
  console.log(`🧹 Iniciando purga de registros Demo en ${url}...`);

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname,
      method:   'DELETE',
      headers: {
        'x-api-key': SAAS_API_KEY,
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          if (res.statusCode === 200) {
            console.log('✅ Purga completada exitosamente:', body.message);
            resolve();
          } else {
            console.error(`❌ Error HTTP ${res.statusCode}:`, body.error || data);
            reject(new Error(body.error || 'Purge failed'));
          }
        } catch (e) {
          console.error('❌ Error al procesar respuesta:', data);
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

purge().catch(err => {
  console.error('💥 Error fatal:', err.message);
  process.exit(1);
});
