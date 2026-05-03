'use strict';

/**
 * enricher.js
 * Enriquece leads No-GC con datos de contacto usando la API de Outscraper.
 *
 * Flujo:
 *   Dirección del Permiso → Búsqueda Outscraper (Google Maps) → Teléfono + Nombre
 *
 * Optimizaciones:
 *   - Modo Paralelo: Procesa múltiples leads simultáneamente con límite de concurrencia.
 *   - Sistema de Caché: Evita re-consultar direcciones ya procesadas.
 */

const https  = require('https');
const path   = require('path');
const fs     = require('fs-extra');
const { createObjectCsvWriter } = require('csv-writer');
const Logger = require('./utils/logger');
const CacheManager = require('./utils/cache_manager');

// Ciudades que califican para clasificación DIAMANTE
const DIAMOND_CITIES = new Set(['SIESTA KEY', 'LONGBOAT KEY', 'LAKEWOOD RANCH']);

// Categorías con alta probabilidad de tener Google Maps Business listing
const COMMERCIAL_CATEGORIES = new Set(['cgc']);

// Palabras clave en el tipo de permiso que sugieren uso comercial
const COMMERCIAL_KEYWORDS = [
  'COMMERCIAL', 'RENOVATION', 'REMODEL', 'ADDITION', 'RETAIL',
  'OFFICE', 'RESTAURANT', 'HOTEL', 'BUSINESS',
];

class Enricher {
  constructor(config) {
    this.config  = config;
    this.logger  = new Logger(config.logging);
    this.apiKey  = process.env.OUTSCRAPER_API_KEY || '';
    this.baseUrl = 'api.outscraper.com';
    this.cache   = new CacheManager(path.join(process.cwd(), '.tmp', 'enrichment_cache.json'));
  }

  /**
   * Enriquece un array de leads No-GC con datos de contacto de Outscraper.
   *
   * @param {object[]} leads
   * @param {object}   opts
   * @param {boolean}  opts.onlyCommercial  — solo procesar leads CGC/comerciales (default: true)
   * @param {number}   opts.concurrency     — número de peticiones en paralelo (default: 3)
   * @param {boolean}  opts.dryRun          — simular sin llamar a la API (default: si no hay API key)
   * @returns {Promise<{ enriched: object[], stats: object }>}
   */
  async run(leads, opts = {}) {
    const {
      onlyCommercial = true,
      concurrency    = 3,
      dryRun         = !this.apiKey,
    } = opts;

    if (!this.apiKey && !dryRun) {
      this.logger.error('OUTSCRAPER_API_KEY no configurada en .env. Agrega: OUTSCRAPER_API_KEY=tu_key');
      throw new Error('Missing OUTSCRAPER_API_KEY');
    }

    this.logger.separator('ENRICHER — OUTSCRAPER (PARALLEL MODE)');
    this.logger.info(`Total leads recibidos : ${leads.length}`);
    this.logger.info(`Solo comerciales      : ${onlyCommercial}`);
    this.logger.info(`Concurrencia          : ${concurrency}`);
    this.logger.info(`Modo                  : ${dryRun ? 'DRY RUN (sin API key)' : 'LIVE'}`);

    const stats = {
      total:      leads.length,
      attempted:  0,
      found:      0,
      skipped:    0,
      failed:     0,
      cached:     0,
      creditsUsed: 0,
    };

    const results = [];
    const queue = [...leads];
    const activeWorkers = [];

    // Worker function
    const processLead = async (lead) => {
      // Solo procesar No-GC
      if (!lead.flags?.noGC) {
        stats.skipped++;
        return { ...lead, outscraper: { status: 'SKIP_HAS_GC' } };
      }

      // Filtrar por tipo comercial si se pide
      const isCommercial = this._isCommercialLead(lead);
      if (onlyCommercial && !isCommercial) {
        stats.skipped++;
        return {
          ...lead,
          outscraper: {
            status: 'SKIP_RESIDENTIAL',
            note:   'Propiedad residencial — Google Maps no tiene listing de propietarios privados.',
          },
        };
      }

      const cacheKey = `${lead.address}_${lead.city}`.toUpperCase();
      const cached = this.cache.get(cacheKey);
      if (cached) {
        stats.cached++;
        if (cached.phone) stats.found++;
        this.logger.info(`📦 [CACHE] ${lead.address} → ${cached.phone || 'NO_PHONE'}`);
        return { ...lead, outscraper: cached };
      }

      stats.attempted++;

      try {
        const result = dryRun
          ? this._mockResult(lead)
          : await this._searchOutscraper(lead);

        const parsed = this._parseResult(result, lead);
        
        if (parsed.phone && parsed.status === 'FOUND') {
          stats.found++;
          this.logger.info(`✅ ${lead.address}, ${lead.city} → ${parsed.phone}`);
          this.cache.set(cacheKey, parsed);
        } else {
          stats.failed++;
          this.logger.debug(`❌ Sin teléfono: ${lead.address}, ${lead.city}`);
          this.cache.set(cacheKey, parsed); // Cache negative results too
        }

        stats.creditsUsed += result._creditsUsed || 0;
        return { ...lead, outscraper: parsed };
      } catch (err) {
        this.logger.error(`Error en ${lead.address}: ${err.message}`);
        stats.failed++;
        return { ...lead, outscraper: { status: 'ERROR', error: err.message } };
      }
    };

    // Parallel execution loop with concurrency limit
    while (queue.length > 0 || activeWorkers.length > 0) {
      while (activeWorkers.length < concurrency && queue.length > 0) {
        const lead = queue.shift();
        const promise = processLead(lead).then(res => {
          results.push(res);
          activeWorkers.splice(activeWorkers.indexOf(promise), 1);
        });
        activeWorkers.push(promise);
      }
      if (activeWorkers.length > 0) {
        await Promise.race(activeWorkers);
      }
    }

    this.logger.info('Enriquecimiento completo', stats);

    // Clasificar DIAMANTE y escribir CSV final
    const withClassification = results.map(l => this._classify(l));
    await this._writeDiamondCSV(withClassification);

    return { enriched: withClassification, stats };
  }

  // ─── Clasificación DIAMANTE ───────────────────────────────────────────────

  _classify(lead) {
    const cityKey      = (lead.city || '').trim().toUpperCase();
    const hasPhone     = !!(lead.outscraper?.phone);
    const tpv          = lead.projectValue?.totalProjectValue || lead.valuation || 0;
    const isDiamondCity = DIAMOND_CITIES.has(cityKey);

    // Diamante: ciudad premium + teléfono verificado por Outscraper
    const isDiamond = isDiamondCity && hasPhone;

    // Nota de urgencia de cierre si TPV > $50k
    const urgencyClose = tpv >= 50000
      ? `⚡ CIERRE URGENTE — Proyecto $${tpv.toLocaleString('en-US')} en ${lead.city}. Contactar en 48h.`
      : '';

    return {
      ...lead,
      diamondClass:  isDiamond ? 'DIAMANTE' : (isDiamondCity ? 'PREMIUM_SIN_TEL' : 'STANDARD'),
      urgencyClose,
    };
  }

  // ─── Escribir LEADS_DIAMANTE_CON_TELEFONO.csv ─────────────────────────────

  async _writeDiamondCSV(leads) {
    const ts      = new Date().toISOString().slice(0, 10);
    const outDir  = this.config.output?.directory || './output';
    const outPath = path.join(outDir, `LEADS_DIAMANTE_CON_TELEFONO_${ts}.csv`);

    await fs.ensureDir(outDir);

    const relevant = leads.filter(l =>
      l.diamondClass === 'DIAMANTE' || l.diamondClass === 'PREMIUM_SIN_TEL' ||
      (l.flags?.noGC && l.flags?.premium)
    );

    if (relevant.length === 0) {
      this.logger.warn('Ningún lead DIAMANTE/PREMIUM para el CSV de salida.');
      return;
    }

    const writer = createObjectCsvWriter({
      path: outPath,
      header: [
        { id: 'diamondClass',    title: 'Clasificación' },
        { id: 'score',           title: 'Score' },
        { id: 'tier',            title: 'Tier' },
        { id: 'category',        title: 'Categoría' },
        { id: 'permitNumber',    title: 'Permiso #' },
        { id: 'permitDate',      title: 'Fecha Permiso' },
        { id: 'status',          title: 'Status' },
        { id: 'address',         title: 'Dirección' },
        { id: 'city',            title: 'Ciudad' },
        { id: 'county',          title: 'Condado' },
        { id: 'zip',             title: 'ZIP' },
        { id: 'ownerName',       title: 'Propietario' },
        { id: 'phone',           title: 'Teléfono (Outscraper)' },
        { id: 'businessName',    title: 'Nombre en Google Maps' },
        { id: 'website',         title: 'Website' },
        { id: 'phoneSource',     title: 'Fuente Teléfono' },
        { id: 'valuation',       title: 'Valor Declarado ($)' },
        { id: 'totalProjectValue', title: 'Total Project Value ($)' },
        { id: 'estNetProfit',    title: 'Est. Net Profit 30% ($)' },
        { id: 'partnerShare',    title: 'MultiVenza Partner Share 35% ($)' },
        { id: 'roofAge',         title: 'Edad Techo (años)' },
        { id: 'noGC',            title: 'No-GC' },
        { id: 'urgencyClose',    title: 'Nota Urgencia de Cierre' },
        { id: 'urgencyLevel',    title: 'Nivel Urgencia' },
        { id: 'salesNote',       title: 'Script de Llamada' },
        { id: 'source',          title: 'Fuente Datos' },
      ],
    });

    const rows = relevant.map(l => ({
      diamondClass:      l.diamondClass,
      score:             l.score,
      tier:              l.tier,
      category:          l.category,
      permitNumber:      l.permitNumber,
      permitDate:        l.permitDate,
      status:            l.status,
      address:           l.address,
      city:              l.city,
      county:            l.county,
      zip:               l.zip,
      ownerName:         l.ownerName || '',
      phone:             l.outscraper?.phone || '',
      businessName:      l.outscraper?.businessName || '',
      website:           l.outscraper?.website || '',
      phoneSource:       l.outscraper?.phone ? 'Outscraper / Google Maps' : '',
      valuation:         l.valuation,
      totalProjectValue: l.projectValue?.totalProjectValue || '',
      estNetProfit:      l.projectValue?.estNetProfit || '',
      partnerShare:      l.projectValue?.partnerShare || '',
      roofAge:           l.roofAnalysis?.age || '',
      noGC:              l.flags?.noGC ? 'YES' : 'NO',
      urgencyClose:      l.urgencyClose || '',
      urgencyLevel:      l.urgency?.level || '',
      salesNote:         l.urgency?.salesNote || '',
      source:            l.source,
    }));

    await writer.writeRecords(rows);
    this.logger.info(`DIAMANTE CSV → ${outPath}  (${rows.length} leads)`);
  }

  _searchOutscraper(lead) {
    const query = this._buildQuery(lead);
    const path  = `/maps/search-v3?query=${encodeURIComponent(query)}&language=en&region=US&organizationsPerQueryLimit=1&async=false&apiKey=${this.apiKey}`;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        path,
        method:  'GET',
        headers: { 'X-API-KEY': this.apiKey },
      };

      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
               return reject(new Error(`Outscraper HTTP ${res.statusCode}`));
            }
            const body = JSON.parse(data);
            body._creditsUsed = body.credits_used || 1;
            resolve(body);
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }

  _buildQuery(lead) {
    const addr = [lead.address, lead.city, 'FL', lead.zip].filter(Boolean).join(', ');
    const hint = this._isCommercialLead(lead) ? ' business' : '';
    return `${addr}${hint}`;
  }

  _parseResult(raw, lead) {
    const results = (raw.data || [])[0] || [];
    const first   = results[0];

    if (!first) {
      return { status: 'NOT_FOUND', phone: null };
    }

    const returnedAddr = (first.address || first.full_address || '').toUpperCase();
    const leadAddr     = (lead.address || '').toUpperCase();
    const addrMatch    = returnedAddr.includes(leadAddr.split(' ')[0]);

    const phone = first.phone || first.phone_1 || null;

    return {
      status:         (phone && addrMatch) ? 'FOUND' : 'NO_PHONE',
      businessName:   first.name || first.business_name || null,
      phone:          this._normalizePhone(phone),
      website:        first.site || first.website || null,
      fullAddress:    first.address || first.full_address || null,
      addressMatch:   addrMatch
    };
  }

  _normalizePhone(raw) {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
    return raw;
  }

  _isCommercialLead(lead) {
    if (COMMERCIAL_CATEGORIES.has(lead.category)) return true;
    const typeUpper = (lead.permitType || '').toUpperCase();
    return COMMERCIAL_KEYWORDS.some(kw => typeUpper.includes(kw));
  }

  _mockResult(lead) {
    const isCommercial  = this._isCommercialLead(lead);
    const cityKey       = (lead.city || '').trim().toUpperCase();
    const isPremiumCity = DIAMOND_CITIES.has(cityKey);

    const generatePhone = isCommercial || isPremiumCity;
    if (!generatePhone) return { _creditsUsed: 0, data: [[null]] };

    const areaCode = cityKey === 'TAMPA' ? '813' : '941';
    const mid      = String(Math.floor(200 + Math.random() * 800));
    const last     = String(Math.floor(1000 + Math.random() * 9000));
    const phone    = `(${areaCode}) ${mid}-${last}`;

    const nameMap = {
      cgc:          `${lead.city} General Contractors LLC`,
      roofing:      `${lead.city} Roofing & Restoration`,
      homeBuilders: `${lead.city} Custom Homes`,
    };
    const name = nameMap[lead.category] || `${lead.city} Property`;

    return {
      _creditsUsed: 1,
      data: [[{
        name,
        phone,
        address:  `${lead.address}, ${lead.city}, FL ${lead.zip || ''}`.trim(),
        site:     null,
        rating:   (3.5 + Math.random() * 1.5).toFixed(1),
        place_id: `mock_${lead.permitNumber}`,
      }]],
    };
  }
}

module.exports = Enricher;
