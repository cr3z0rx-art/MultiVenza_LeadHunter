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

// ─── Source definitions ───────────────────────────────────────────────────────

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
  'Miami-Dade': {
    baseUrl: 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0',
    county: 'Miami-Dade',
    state: 'FL',
    permitTypes: ['BLDG', 'ELEC', 'MECH'],
    valuationField: 'EstimatedValue',
    typeField: 'PermitType',
    dateField: 'PermitIssuedDate',
    outFields: 'PermitNumber,PermitType,PermitIssuedDate,PropertyAddress,City,EstimatedValue,ApplicationTypeDescription,OwnerName,ContractorName',
  },
  'Orange': {
    baseUrl: 'https://services.arcgis.com/OrangeFL/arcgis/rest/services/Fast_Track_Permits/FeatureServer/0',
    county: 'Orange County',
    state: 'FL',
    permitTypes: ['BLDG', 'ELEC', 'MECH'],
    typeField: 'TYPE', dateField: 'ISSUED_DATE', outFields: '*'
  },
  'Palm Beach': {
    baseUrl: 'https://services.arcgis.com/PalmBeachFL/arcgis/rest/services/PZB_Permits/FeatureServer/0',
    county: 'Palm Beach',
    state: 'FL',
    permitTypes: ['BLDG', 'ELEC', 'MECH'],
    typeField: 'TYPE', dateField: 'ISSUED_DATE', outFields: '*'
  },
  'Fulton': {
    baseUrl: 'https://services.arcgis.com/AtlantaGA/arcgis/rest/services/Building_Permits/FeatureServer/0',
    county: 'Fulton',
    state: 'GA',
    permitTypes: ['BLDG', 'ELEC', 'MECH'],
    typeField: 'TYPE', dateField: 'ISSUED_DATE', outFields: '*'
  },
  'Broward': {
    baseUrl: 'https://services.arcgis.com/BrowardFL/arcgis/rest/services/Permits/FeatureServer/0',
    county: 'Broward',
    state: 'FL',
    permitTypes: ['BLDG', 'ELEC', 'MECH'],
    typeField: 'TYPE', dateField: 'ISSUED_DATE', outFields: '*'
  },
  'Pinellas': {
    baseUrl: 'https://services.arcgis.com/PinellasFL/arcgis/rest/services/Permits/FeatureServer/0',
    county: 'Pinellas',
    state: 'FL',
    permitTypes: ['BLDG', 'ELEC', 'MECH'],
    typeField: 'TYPE', dateField: 'ISSUED_DATE', outFields: '*'
  },
  'Harris': {
    baseUrl:    'https://www.gis.hctx.net/arcgishcpid/rest/services/Permits/IssuedPermits/FeatureServer/0',
    county:     'Harris',
    state:      'TX',
    permitTypes: ['Residential', 'Commercial', 'Building'],
    valuationField: 'VALUATION',
    typeField: 'APPTYPE',
    dateField: 'ISSUEDDATE',
    outFields: 'PERMITNUMBER,APPTYPE,ISSUEDDATE,FULLADDRESS,VALUATION,PROJECTNAME',
  },
  'Maricopa': {
    baseUrl:    'https://gis.maricopa.gov/arcgis/rest/services/Planning/Building_Permits/FeatureServer/0',
    county:     'Maricopa',
    state:      'AZ',
    permitTypes: ['BLDG', 'ELEC', 'MECH'],
    typeField: 'TYPE', dateField: 'ISSUED_DATE', outFields: '*'
  },
};

// ─── Demo data (Sarasota + premium cities) ────────────────────────────────────

function _buildSarasotaDemoRecords(count = 50) {
  const today = new Date();
  const records = [];

  const sarasotaTemplates = [
    // ── Original 25 templates ──
    { city: 'Siesta Key',     zip: '34242', type: 'Residential Roofing',     desc: 'RE-ROOF - Tile to Metal Roof Replacement',      val: 28000,  contractor: null },
    { city: 'Siesta Key',     zip: '34242', type: 'Residential Roofing',     desc: 'REROOF - Flat roof membrane replacement',         val: 35000,  contractor: null },
    { city: 'Longboat Key',   zip: '34228', type: 'Residential New Construction', desc: 'New Single Family Residence - Custom Home',   val: 1850000, contractor: 'COASTAL BUILDERS LLC' },
    { city: 'Longboat Key',   zip: '34228', type: 'Residential Roofing',     desc: 'ROOF REPLACEMENT - Hurricane damage repair',     val: 52000,  contractor: null },
    { city: 'Lakewood Ranch', zip: '34202', type: 'Residential New Construction', desc: 'New Single Family Residential Construction', val: 420000, contractor: null },
    { city: 'Lakewood Ranch', zip: '34202', type: 'Residential Roofing',     desc: 'RE-ROOF - Shingle replacement - 17 yr old roof', val: 22000,  contractor: null },
    { city: 'Lakewood Ranch', zip: '34211', type: 'Commercial New Construction', desc: 'New Construction commercial addition remodel', val: 680000, contractor: 'PREMIER CGC INC' },
    { city: 'Venice',         zip: '34285', type: 'Residential Roofing',     desc: 'ROOF REPLACEMENT - Flat roof - age 16 years',    val: 18500,  contractor: null },
    { city: 'Venice',         zip: '34292', type: 'Residential New Construction', desc: 'Single Family Residential New Construction', val: 310000, contractor: 'GULF COAST BUILDERS' },
    { city: 'North Port',     zip: '34291', type: 'Residential New Construction', desc: 'New Single Family Residence construction',   val: 275000, contractor: null },
    { city: 'North Port',     zip: '34291', type: 'Residential Roofing',     desc: 'REROOF - tile roof replacement - 15 year old',   val: 19000,  contractor: null },
    { city: 'Nokomis',        zip: '34275', type: 'Residential Roofing',     desc: 'RE-ROOF metal roof replacement',                val: 24000,  contractor: null },
    { city: 'Bradenton',      zip: '34205', type: 'Residential Roofing',     desc: 'ROOF REPLACEMENT shingle re-roof',               val: 15000,  contractor: 'SUNCOAST ROOFING' },
    { city: 'Bradenton',      zip: '34210', type: 'Residential New Construction', desc: 'New Home Construction single family',       val: 380000, contractor: null },
    { city: 'Palmetto',       zip: '34221', type: 'Residential Roofing',     desc: 'REROOF - complete shingle roof replacement',     val: 16500,  contractor: null },
    { city: 'Laurel',         zip: '34272', type: 'Residential Roofing',     desc: 'RE-ROOF - tile replacement 18 yr roof age',     val: 27000,  contractor: null },
    { city: 'Siesta Key',     zip: '34242', type: 'Commercial New Construction', desc: 'Commercial renovation and remodel addition', val: 925000, contractor: null },
    { city: 'Longboat Key',   zip: '34228', type: 'Residential New Construction', desc: 'Custom Home New Construction Single Family', val: 2200000, contractor: null },
    { city: 'Lakewood Ranch', zip: '34202', type: 'Residential Roofing',     desc: 'ROOF REPLACEMENT - Full re-roof metal panels',   val: 31000,  contractor: null },
    { city: 'Venice',         zip: '34285', type: 'Commercial New Construction', desc: 'New construction CGC commercial project',    val: 540000, contractor: 'VENICE CONSTRUCTION' },
    { city: 'North Port',     zip: '34291', type: 'Residential Roofing',     desc: 'RE-ROOF - Complete reroof after inspection',    val: 20500,  contractor: null },
    { city: 'Siesta Key',     zip: '34242', type: 'Residential Roofing',     desc: 'REROOF full replacement - 20 year old tile',    val: 42000,  contractor: null },
    { city: 'Lakewood Ranch', zip: '34211', type: 'Residential New Construction', desc: 'New Custom Luxury Home Single Family Res',  val: 850000, contractor: null },
    { city: 'Bradenton',      zip: '34208', type: 'Residential Roofing',     desc: 'RE-ROOF shingle to metal upgrade',              val: 23000,  contractor: null },
    { city: 'Longboat Key',   zip: '34228', type: 'Residential Roofing',     desc: 'ROOF REPLACEMENT - full reroof high value',     val: 68000,  contractor: null },
    // ── 25 additional templates ──
    { city: 'Siesta Key',     zip: '34242', type: 'Residential Remodel',     desc: 'Residential Remodel - Kitchen and Bath',          val: 85000,  contractor: null },
    { city: 'Siesta Key',     zip: '34242', type: 'Residential Addition',    desc: 'Residential Addition - Master Suite Expansion',   val: 120000, contractor: null },
    { city: 'Longboat Key',   zip: '34228', type: 'Residential Remodel',    desc: 'Residential Remodel - Full Interior Renovation',  val: 450000, contractor: 'PREMIER CONSTRUCTION' },
    { city: 'Longboat Key',   zip: '34228', type: 'Residential Addition',    desc: 'Residential Addition - Pool and Enclosure',       val: 95000,  contractor: null },
    { city: 'Lakewood Ranch', zip: '34202', type: 'Residential HVAC',       desc: 'HVAC Replacement - Complete System Upgrade',      val: 18500,  contractor: 'LAKEWOOD HVAC SERVICES' },
    { city: 'Lakewood Ranch', zip: '34202', type: 'Residential Electrical', desc: 'Electrical Panel Upgrade 400A Service',           val: 8500,   contractor: null },
    { city: 'Venice',         zip: '34285', type: 'Residential Remodel',     desc: 'Bathroom Remodel - Complete Gut Renovation',      val: 35000,  contractor: null },
    { city: 'Venice',         zip: '34293', type: 'Residential Addition',    desc: 'Residential Addition - Garage Conversion ADU',    val: 65000,  contractor: null },
    { city: 'North Port',     zip: '34287', type: 'Residential HVAC',       desc: 'New HVAC System Installation',                   val: 12000,  contractor: 'NORTH PORT COOLING' },
    { city: 'North Port',     zip: '34289', type: 'Residential Electrical', desc: 'Rewire Existing Home - Full Electrical',          val: 15000,  contractor: null },
    { city: 'Nokomis',        zip: '34275', type: 'Residential Remodel',     desc: 'Kitchen Remodel - Complete Renovation',           val: 48000,  contractor: null },
    { city: 'Nokomis',        zip: '34275', type: 'Residential Addition',    desc: 'Addition - Sunroom Enclosure',                   val: 32000,  contractor: 'SUNROOM BUILDERS LLC' },
    { city: 'Bradenton',      zip: '34209', type: 'Residential Roofing',     desc: 'ROOF REPLACEMENT - Tile roof age 22 years',       val: 27500,  contractor: null },
    { city: 'Bradenton',      zip: '34212', type: 'Residential HVAC',       desc: 'Ductwork Replacement and HVAC Upgrade',          val: 14000,  contractor: null },
    { city: 'Palmetto',       zip: '34221', type: 'Residential New Construction', desc: 'New Single Family Home Construction',       val: 320000, contractor: null },
    { city: 'Palmetto',       zip: '34221', type: 'Residential Roofing',     desc: 'RE-ROOF complete - 14 yr old roof age',         val: 19500,  contractor: 'PALMETTO ROOFING CO' },
    { city: 'Laurel',         zip: '34272', type: 'Residential Addition',    desc: 'Addition - Second Floor Addition',               val: 180000, contractor: null },
    { city: 'Laurel',         zip: '34272', type: 'Residential Remodel',     desc: 'Residential Remodel - Whole House',              val: 75000,  contractor: null },
    { city: 'Siesta Key',     zip: '34242', type: 'Residential Pool',       desc: 'Swimming Pool and Spa Construction',             val: 65000,  contractor: null },
    { city: 'Longboat Key',   zip: '34228', type: 'Residential Pool',       desc: 'Lap Pool and Outdoor Kitchen Construction',      val: 95000,  contractor: 'LUXURY POOLS INC' },
    { city: 'Lakewood Ranch', zip: '34202', type: 'Residential Addition',    desc: 'Residential Addition - 3 Car Garage Expansion',   val: 42000,  contractor: null },
    { city: 'Osprey',         zip: '34229', type: 'Residential Roofing',     desc: 'ROOF REPLACEMENT - 16 yr old roof replacement', val: 22000,  contractor: null },
    { city: 'Osprey',         zip: '34229', type: 'Residential New Construction', desc: 'New Construction Single Family Residence', val: 450000, contractor: 'GULF BUILDERS INC' },
    { city: 'Sarasota',       zip: '34236', type: 'Commercial Remodel',     desc: 'Commercial Remodel - Office Build Out',          val: 125000, contractor: null },
    { city: 'Sarasota',       zip: '34237', type: 'Residential Roofing',     desc: 'REROOF - Flat commercial roof membrane',        val: 34000,  contractor: 'SARASOTA ROOFING LLC' },
  ];

  const premiumCities = new Set(['SIESTA KEY', 'LONGBOAT KEY', 'LAKEWOOD RANCH']);

  for (let i = 0; i < Math.min(count, sarasotaTemplates.length); i++) {
    const t = sarasotaTemplates[i];
    const daysAgo = Math.floor(Math.random() * 55) + 1; // 1–55 days ago (up from 28)
    const permitDate = new Date(today);
    permitDate.setDate(permitDate.getDate() - daysAgo);

    const isRoofing = t.desc.toUpperCase().includes('ROOF');
    // Simulate roofYear for roofing permits: 13–22 years ago (up from 13-20)
    const roofAge   = isRoofing ? (Math.floor(Math.random() * 10) + 13) : null;
    const roofYear  = roofAge ? new Date(today.getFullYear() - roofAge, 5, 1).toISOString().slice(0, 10) : null;

    const isPremium = premiumCities.has(t.city.toUpperCase());

    records.push({
      permitNumber:   `SC-BLD-26-${String(2000000 + i).slice(1)}`,
      permitType:     t.desc,   // full description for keyword matching
      permitDate:     permitDate.toISOString().slice(0, 10),
      status:         'Issued',
      address:        `${1000 + i * 17} ${['Gulf Dr', 'Bay Blvd', 'Palm Ave', 'Beach Rd', 'Shoreline Dr', 'Ocean Blvd', 'Harbor Ct', 'Island Dr', 'Sunset Ln', 'Marina Dr'][i % 10]}`,
      city:           t.city,
      state:          'FL',
      county:         'Sarasota',
      zip:            t.zip,
      ownerName:      `Owner ${i + 1}`,
      contractorName: t.contractor,
      contractorLic:  null,
      valuation:      t.val,
      roofYear,
      source:         'Sarasota County Permit Office (Demo)',
      tier:           isPremium ? 'PREMIUM' : 'STANDARD',
      tags:           isPremium ? ['PREMIUM'] : [],
    });
  }

  return records;
}

function _buildExpansionDemoRecords(county, count = 25) {
  const today = new Date();
  const records = [];
  let city, zip, state;
  if (county === 'Harris') {
    city = 'Houston'; zip = '77002'; state = 'TX';
  } else if (county === 'Maricopa') {
    city = 'Phoenix'; zip = '85001'; state = 'AZ';
  } else {
    return [];
  }

  const templates = [
    { type: 'Residential Roofing', desc: 'RE-ROOF', val: 28000, owner: 'John Doe' },
    { type: 'Commercial New Construction', desc: 'New building', val: 500000, owner: 'TEXAS BUILDERS LLC' },
    { type: 'Residential Roofing', desc: 'Roof replacement', val: 15000, owner: 'Jane Smith' },
    { type: 'Residential New Construction', desc: 'New Home', val: 250000, owner: 'PHOENIX HOLDINGS INC' },
    { type: 'Residential Roofing', desc: 'Shingle repair', val: 12000, owner: 'Carlos Rodriguez' },
    { type: 'Residential Roofing', desc: 'Flat roof membrane', val: 18000, owner: 'Emma Watson' },
    { type: 'Residential Roofing', desc: 'Tile roof upgrade', val: 32000, owner: 'Michael Johnson' },
    { type: 'Commercial Remodel', desc: 'Office remodel', val: 75000, owner: 'INNOVATION PARTNERS LLC' },
  ];

  for (let i = 0; i < Math.min(count, templates.length * 2); i++) {
    const t = templates[i % templates.length];
    const permitDate = new Date(today);
    permitDate.setDate(permitDate.getDate() - (Math.floor(Math.random() * 28) + 1));
    
    // Logic for owner
    const ownerName = (i % 4 === 0) ? `${t.owner.split(' ')[0]} CORP` : t.owner;

    records.push({
      permitNumber:   `${state}-BLD-${Date.now().toString().slice(-6)}-${i}`,
      permitType:     t.desc,
      permitDate:     permitDate.toISOString().slice(0, 10),
      status:         'Issued',
      address:        `${1000 + i * 17} Main St`,
      city:           city,
      county:         county,
      zip:            zip,
      ownerName:      ownerName,
      contractorName: null,
      contractorLic:  null,
      valuation:      t.val,
      roofYear:       null,
      source:         `${county} County (Demo)`,
      tier:           'STANDARD',
      tags:           [],
      state:          state
    });
  }
  return records;
}

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

  if (source.county === 'Harris') {
    const val = parseFloat(a.VALUATION) || 0;
    return {
      permitNumber:   a.PERMITNUMBER || `TX-HARRIS-${Date.now()}`,
      permitType:     a.APPTYPE || 'Building Permit',
      permitDate:     _parseDate(a.ISSUEDDATE),
      status:         'Issued',
      address:        a.FULLADDRESS || '',
      city:           'Houston',
      state:          'TX',
      county:         'Harris',
      zip:            '',
      ownerName:      a.PROJECTNAME || null,
      contractorName: null,
      contractorLic:  null,
      valuation:      val,
      roofYear:       null,
      source:         'Harris County ArcGIS',
      tier:           'STANDARD',
      tags:           [],
    };
  }

  if (source.county === 'Miami-Dade') {
    const { city, zip } = _parseCity(a.City);
    const typeDesc = [a.PermitType, a.ApplicationTypeDescription].filter(Boolean).join(' ').trim();
    const val = parseFloat(a.EstimatedValue) || 0;
    return {
      permitNumber:   a.PermitNumber || `MD-UNKNOWN-${Date.now()}`,
      permitType:     typeDesc,
      permitDate:     _parseDate(a.PermitIssuedDate),
      status:         'Issued',
      address:        a.PropertyAddress || '',
      city,
      state:          source.state || 'FL',
      county:         'Miami-Dade',
      zip,
      ownerName:      a.OwnerName || null,
      contractorName: a.ContractorName || null,
      contractorLic:  null,
      valuation:      val,
      roofYear:       null,
      source:         'Miami-Dade ArcGIS',
      tier:           'STANDARD',
      tags:           [],
    };
  }

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
      counties         = ['Hillsborough', 'Sarasota'],
      daysBack         = 30,
      maxRecords       = 1000,
      sarasotaDemoMode = true,
    } = opts;

    this.logger.separator('ARCGIS EXTRACTOR');
    this.logger.info(`Counties: ${counties.join(', ')}`);
    this.logger.info(`Days back: ${daysBack}  |  Max per county: ${maxRecords}`);

    const allRecords = [];

    for (const county of counties) {
      if (county === 'Sarasota') {
        if (sarasotaDemoMode) {
          this.logger.info('Sarasota: no public ArcGIS API available — using realistic demo data');
          const demo = _buildSarasotaDemoRecords(Math.min(maxRecords, 50));
          allRecords.push(...demo);
          this.logger.info(`Sarasota demo: ${demo.length} records`);
        } else {
          this.logger.warn('Sarasota live mode requested but no endpoint available — skipping');
        }
        continue;
      }

      if (county === 'Harris' || county === 'Maricopa') {
        this.logger.info(`${county}: no public ArcGIS API available — using demo data`);
        const demo = _buildExpansionDemoRecords(county, Math.min(maxRecords, 20));
        allRecords.push(...demo);
        this.logger.info(`${county} demo: ${demo.length} records`);
        continue;
      }

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
