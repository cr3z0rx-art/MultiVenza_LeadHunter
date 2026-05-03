'use strict';

/**
 * arcgis_extractor.js
 * Pulls real permit records from Florida county ArcGIS REST endpoints.
 * No authentication required — these are public FeatureServer endpoints.
 *
 * Currently supported counties (live ArcGIS):
 *   Hillsborough → services.arcgis.com/apTfC6SUmnNfnxuF/...
 *                  AccelaDashBoard_MapService20211019 / FeatureServer / Layer 4
 *                  Fields: PERMIT__, TYPE, ISSUED_DATE, ADDRESS, CITY, Value,
 *                          DESCRIPTION, STATUS, PARCEL, OCCUPANCY_TYPE, CATEGORY
 *
 * NOTA: Solo se incluyen condados con endpoints REALES verificados.
 *       Datos demo/fake no se generan — el pipeline solo produce leads reales.
 *
 * RawPermit shape (matches processor.js expectations):
 * {
 *   permitNumber, permitType, permitDate, status,
 *   address, city, county, zip,
 *   ownerName, contractorName, contractorLic,
 *   valuation, roofYear, source,
 *   tier: 'PREMIUM'|'STANDARD', tags: string[]
 * }
 */

const https  = require('https');
const Logger = require('./utils/logger');

// ─── Source definitions — ONLY VERIFIED REAL ENDPOINTS ────────────────────────

const ARCGIS_SOURCES = {
  Hillsborough: {
    baseUrl:    'https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer/4',
    county:     'Hillsborough',
    state:      'FL',
    permitTypes: [
      'Residential New Construction',
      'Residential Building Alterations (Renovations)',
      'Residential Miscellaneous',
      'Commercial New Construction',
      'Residential Remodel',
      'Commercial Remodel',
      'Residential Addition',
    ],
    valuationField: 'Value',
    typeField: 'TYPE',
    dateField: 'ISSUED_DATE',
    outFields: 'PERMIT__,TYPE,ISSUED_DATE,ADDRESS,CITY,Value,DESCRIPTION,STATUS,PARCEL',
  },
};

// ─── Demo functions removed — NO fake data ────────────────────────────────────
// Sarasota County does not have a public ArcGIS REST API available.
// If a real endpoint is found in the future, add it to ARCGIS_SOURCES above.
// Same for Harris (TX), Maricopa (AZ), and other expansion counties.

// ─── ArcGIS query helper ──────────────────────────────────────────────────────

function _httpsGet(url, postData) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message} — body: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function _buildPostData(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// ─── Field parsers ────────────────────────────────────────────────────────────

/**
 * Parse Hillsborough CITY field "Tampa 33615" → { city: "Tampa", zip: "33615" }
 * Some values: "Tampa 33615", "Apollo Beach 33572", "Plant City 33563"
 */
function _parseCity(rawCity) {
  if (!rawCity) return { city: '', zip: '' };
  const parts = rawCity.trim().split(/\s+/);
  // Last part is usually a 5-digit ZIP
  if (parts.length >= 2 && /^\d{5}$/.test(parts[parts.length - 1])) {
    const zip  = parts.pop();
    const city = parts.join(' ');
    return { city, zip };
  }
  return { city: rawCity.trim(), zip: '' };
}

/**
 * Convert ArcGIS epoch-ms timestamp to ISO date string "YYYY-MM-DD"
 */
function _parseDate(epochMs) {
  if (!epochMs) return null;
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Extract contractor name from DESCRIPTION field using known patterns.
 * Returns null if OWNER BUILDER or HOMEOWNER patterns detected (No-GC).
 */
function _extractContractorFromDesc(description) {
  if (!description) return null;
  const upperDesc = description.toUpperCase();
  // If OWNER BUILDER or HOMEOWNER → No-GC confirmed
  if (/OWNER\s+BUILDER|HOMEOWNER/i.test(description)) return null;
  // Look for GC:, Contractor:, CONTRACTOR patterns
  const match = description.match(/(?:GC|CONTRACTOR|CONTRACT)\s*[:.]?\s*([A-Z][A-Z\s.]+?(?=,|\.|$|\s+-\s+))/i);
  if (match) return match[1].trim();
  return null;
}

/**
 * Extract owner name from DESCRIPTION field using known patterns.
 */
function _extractOwnerFromDesc(description) {
  if (!description) return null;
  const match = description.match(/(?:Owner|Applicant)\s*[:.]?\s*([A-Z][A-Z\s.]+?(?=,|\.|$))/i);
  if (match) return match[1].trim();
  return null;
}

function _mapFeature(feature, source) {
  const a = feature.attributes;
  const { city, zip } = _parseCity(a.CITY);

  // Combine TYPE + DESCRIPTION for richer keyword matching in processor
  const typeDesc = [a.TYPE, a.DESCRIPTION].filter(Boolean).join(' ').trim();

  return {
    permitNumber:   a.PERMIT__ || `${source.county}-UNKNOWN-${Date.now()}`,
    permitType:     typeDesc,
    permitDate:     _parseDate(a.ISSUED_DATE),
    status:         a.STATUS || 'Issued',
    address:        a.ADDRESS || '',
    city,
    state:          source.state || 'FL',
    county:         source.county || 'Unknown',
    zip,
    ownerName:      _extractOwnerFromDesc(a.DESCRIPTION),
    contractorName: _extractContractorFromDesc(a.DESCRIPTION),
    contractorLic:  null,
    valuation:      typeof a.Value === 'number' ? a.Value : 0,
    roofYear:       null,        // derive from permitDate in roof rules
    source:         `${source.county} ArcGIS`,
    tier:           'STANDARD',  // processor will re-classify by city
    tags:           [],
  };
}

// ─── Main extractor class ─────────────────────────────────────────────────────

class ArcGISExtractor {
  constructor(config) {
    this.config         = config;
    this.logger         = new Logger(config.logging);
    this._premiumCities = new Set(
      (config.region.premiumCities || []).map(c => c.trim().toUpperCase())
    );
  }

  /**
   * @param {object} opts
   * @param {string[]} opts.counties           — e.g. ['Hillsborough', 'Sarasota']
   * @param {number}   opts.daysBack           — how many days back to query (default 30)
   * @param {number}   opts.maxRecords         — max records per county (default 1000)
   * @param {boolean}  opts.sarasotaDemoMode   — use demo data for Sarasota (default true,
   *                                             since no public API exists for Sarasota)
   * @returns {Promise<object[]>} rawRecords
   */
  async run(opts = {}) {
    const {
      counties         = ['Hillsborough'],
      daysBack         = 30,
      maxRecords       = 1000,
    } = opts;

    this.logger.separator('ARCGIS EXTRACTOR');
    this.logger.info(`Counties: ${counties.join(', ')}`);
    this.logger.info(`Days back: ${daysBack}  |  Max per county: ${maxRecords}`);

    const allRecords = [];

    for (const county of counties) {
      const source = ARCGIS_SOURCES[county];
      if (!source) {
        this.logger.warn(`No ArcGIS source configured for county: ${county}`);
        continue;
      }

      try {
        const records = await this._queryCounty(source, daysBack, maxRecords);
        allRecords.push(...records);
        this.logger.info(`${county}: ${records.length} records fetched`);
      } catch (err) {
        this.logger.error(`${county} fetch failed: ${err.message}`);
      }
    }

    // Classify premium cities (processor also does this; belt-and-suspenders)
    for (const r of allRecords) {
      if (this._premiumCities.has((r.city || '').trim().toUpperCase())) {
        r.tier = 'PREMIUM';
        if (!r.tags.includes('PREMIUM')) r.tags.push('PREMIUM');
      }
    }

    this.logger.info(`Total raw records: ${allRecords.length}`);
    return allRecords;
  }

  // ─── County query ───────────────────────────────────────────────────────────

  async _queryCounty(source, daysBack, maxRecords) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - daysBack);
    const dateStr = sinceDate.toISOString().slice(0, 10);  // "YYYY-MM-DD"

    const typeField = source.typeField || 'TYPE';
    const dateField = source.dateField || 'ISSUED_DATE';

    const typeList = source.permitTypes.map(t => `'${t}'`).join(',');
    const where    = `${typeField} IN (${typeList}) AND ${dateField} >= date '${dateStr}'`;

    this.logger.debug(`${source.county} query: ${where}`);

    const features = await this._paginateQuery(source.baseUrl, where, maxRecords, source.outFields, dateField);
    return features.map(f => _mapFeature(f, source));
  }

  // ─── Pagination (ArcGIS max 2000 per call) ──────────────────────────────────

  async _paginateQuery(baseUrl, where, maxRecords, outFields, dateField) {
    const pageSize = Math.min(maxRecords, 1000);
    const allFeatures = [];
    let offset = 0;

    while (allFeatures.length < maxRecords) {
      const remaining = maxRecords - allFeatures.length;
      const postData  = _buildPostData({
        where,
        outFields:         outFields || '*',
        resultRecordCount: Math.min(pageSize, remaining),
        resultOffset:      offset,
        orderByFields:     `${dateField || 'ISSUED_DATE'} DESC`,
        f:                 'json',
      });

      const data = await _httpsGet(`${baseUrl}/query`, postData);

      if (data.error) {
        throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
      }

      const features = data.features || [];
      allFeatures.push(...features);

      if (features.length < pageSize || !data.exceededTransferLimit) break;
      offset += features.length;
    }

    return allFeatures;
  }
}

module.exports = ArcGISExtractor;
