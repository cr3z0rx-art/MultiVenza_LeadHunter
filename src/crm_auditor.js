'use strict';

/**
 * crm_auditor.js
 * Reconciles processed leads against the CRM to:
 *
 *  1. DEDUP      — flag leads that already exist in the CRM
 *  2. PUSH       — push net-new leads to the CRM as new contacts/deals
 *  3. CLOSE AUDIT — compare lead outcomes (won/lost/open) against the leads
 *                   we sent and report conversion metrics
 *
 * The auditor is CRM-agnostic. Set CRM_PROVIDER, CRM_API_ENDPOINT, and
 * CRM_API_KEY in .env and fill the field mapping in config.json.
 *
 * Supported providers (extend _getAdapter as needed):
 *   - generic   (REST POST/GET, default)
 *   - hubspot
 *   - gohighlevel
 */

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const Logger = require('./utils/logger');

class CRMAuditor {
  constructor(config) {
    this.config    = config;
    this.crmConfig = config.crm;
    this.logger    = new Logger(config.logging);
    this.adapter   = this._getAdapter(process.env.CRM_PROVIDER || this.crmConfig.provider || 'generic');
    this.apiEndpoint = process.env.CRM_API_ENDPOINT || this.crmConfig.apiEndpoint;
    this.apiKey      = process.env.CRM_API_KEY      || this.crmConfig.apiKey;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Pushes net-new leads to the CRM (skips duplicates).
   * @param {object[]} leads - processed leads from Processor
   * @returns {{ pushed: number, skipped: number, errors: number }}
   */
  async pushLeads(leads) {
    this.logger.separator('CRM PUSH');
    this.logger.info(`Preparing to push ${leads.length} leads to CRM`);

    const stats = { pushed: 0, skipped: 0, errors: 0 };
    const batches = this._chunk(leads, this.crmConfig.auditBatchSize);

    for (const batch of batches) {
      const deduped = await this._deduplicateBatch(batch);
      this.logger.info(`Batch: ${batch.length} total, ${batch.length - deduped.length} duplicates skipped`);
      stats.skipped += batch.length - deduped.length;

      for (const lead of deduped) {
        try {
          await this._pushOne(lead);
          stats.pushed++;
        } catch (err) {
          this.logger.error('Failed to push lead', { leadId: lead.leadId, error: err.message });
          stats.errors++;
        }
      }
    }

    this.logger.info('CRM push complete', stats);
    return stats;
  }

  /**
   * Audits closes: fetches won/lost deals from CRM and matches them
   * against our lead output files to compute conversion metrics.
   * @param {string} leadsFilePath - path to the leads JSON output file
   * @returns {object} audit report
   */
  async auditCloses(leadsFilePath) {
    this.logger.separator('CLOSE AUDIT');
    this.logger.info('Starting close audit against CRM');

    const leads = JSON.parse(fs.readFileSync(leadsFilePath, 'utf8'));
    const crmDeals = await this._fetchCRMDeals();

    const report = this._reconcile(leads, crmDeals);
    this._writeAuditReport(report);

    this.logger.info('Close audit complete', {
      totalLeads:  report.totalLeads,
      matched:     report.matched,
      won:         report.won,
      lost:        report.lost,
      open:        report.open,
      conversionRate: report.conversionRate,
    });

    return report;
  }

  // ─── Deduplication ────────────────────────────────────────────────────────

  /**
   * Checks a batch of leads against the CRM.
   * Returns only the leads that do NOT already exist.
   */
  async _deduplicateBatch(leads) {
    const identifiers = leads.map(l => ({
      leadId:  l.leadId,
      address: l.address,
      permitNumber: l.permitNumber,
    }));

    let existingIds;
    try {
      existingIds = await this.adapter.checkDuplicates(this, identifiers);
    } catch (err) {
      this.logger.warn('Dedup check failed — treating all as new', { error: err.message });
      return leads;
    }

    return leads.filter(l => !existingIds.has(l.leadId));
  }

  // ─── Single lead push ─────────────────────────────────────────────────────

  async _pushOne(lead) {
    const payload = this._mapToPayload(lead);
    await this.adapter.createContact(this, payload);
    this.logger.debug('Pushed lead to CRM', { leadId: lead.leadId });
  }

  /**
   * Maps a processed lead to the CRM's field schema using config.crm.fieldMapping.
   */
  _mapToPayload(lead) {
    const mapping = this.crmConfig.fieldMapping;
    const payload = {};

    for (const [localField, crmField] of Object.entries(mapping)) {
      let value = lead[localField];
      // Flatten nested objects for CRM
      if (localField === 'flags') {
        value = Object.entries(lead.flags)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(', ');
      }
      payload[crmField] = value !== undefined ? value : null;
    }

    return payload;
  }

  // ─── CRM fetch ────────────────────────────────────────────────────────────

  async _fetchCRMDeals() {
    try {
      const deals = await this.adapter.fetchDeals(this);
      this.logger.info(`Fetched ${deals.length} deals from CRM`);
      return deals;
    } catch (err) {
      this.logger.error('Failed to fetch CRM deals', { error: err.message });
      return [];
    }
  }

  // ─── Reconciliation ───────────────────────────────────────────────────────

  _reconcile(leads, crmDeals) {
    // Build a lookup map from CRM deals by external_id / address
    const dealsByExternalId = new Map(crmDeals.map(d => [d.external_id, d]));
    const dealsByAddress    = new Map(crmDeals.map(d => [this._normalizeAddress(d.property_address), d]));

    const results = leads.map(lead => {
      const crmDeal = dealsByExternalId.get(lead.leadId)
        || dealsByAddress.get(this._normalizeAddress(lead.address));

      return {
        leadId:    lead.leadId,
        address:   lead.address,
        county:    lead.county,
        category:  lead.category,
        score:     lead.score,
        noGC:      lead.flags.noGC,
        crmStatus: crmDeal ? crmDeal.deal_status : 'not_found',
        crmDealId: crmDeal ? crmDeal.id : null,
        closeDate: crmDeal ? crmDeal.close_date : null,
        revenue:   crmDeal ? crmDeal.amount : null,
      };
    });

    const matched = results.filter(r => r.crmStatus !== 'not_found');
    const won     = matched.filter(r => r.crmStatus === 'won');
    const lost    = matched.filter(r => r.crmStatus === 'lost');
    const open    = matched.filter(r => !['won', 'lost'].includes(r.crmStatus));

    const totalRevenue = won.reduce((sum, r) => sum + (r.revenue || 0), 0);
    const conversionRate = leads.length > 0
      ? ((won.length / leads.length) * 100).toFixed(2) + '%'
      : '0%';

    // Breakdown by category
    const categoryStats = {};
    for (const cat of ['roofing', 'cgc', 'homeBuilders']) {
      const catLeads = leads.filter(l => l.category === cat);
      const catWon   = won.filter(r => r.category === cat);
      categoryStats[cat] = {
        totalLeads: catLeads.length,
        won: catWon.length,
        conversionRate: catLeads.length > 0
          ? ((catWon.length / catLeads.length) * 100).toFixed(2) + '%'
          : '0%',
      };
    }

    return {
      auditDate:      new Date().toISOString(),
      totalLeads:     leads.length,
      matched:        matched.length,
      won:            won.length,
      lost:           lost.length,
      open:           open.length,
      notFound:       leads.length - matched.length,
      totalRevenue,
      conversionRate,
      categoryStats,
      details:        results,
    };
  }

  _writeAuditReport(report) {
    const dir = this.config.output.directory;
    const ts  = new Date().toISOString().slice(0, 10);
    const outPath = path.join(dir, `audit_report_${ts}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    this.logger.info(`Audit report written: ${outPath}`);
  }

  _normalizeAddress(addr) {
    if (!addr) return '';
    return String(addr).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // ─── Adapter factory ─────────────────────────────────────────────────────

  _getAdapter(provider) {
    switch (provider.toLowerCase()) {
      case 'hubspot':       return new HubSpotAdapter();
      case 'gohighlevel':   return new GoHighLevelAdapter();
      default:              return new GenericRESTAdapter();
    }
  }

  _chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  }
}

// ─── CRM Adapters ─────────────────────────────────────────────────────────────

class GenericRESTAdapter {
  async checkDuplicates(auditor, identifiers) {
    const existing = new Set();
    try {
      const response = await axios.post(
        `${auditor.apiEndpoint}/contacts/check-duplicates`,
        { identifiers },
        { headers: { Authorization: `Bearer ${auditor.apiKey}` } }
      );
      (response.data.existing || []).forEach(id => existing.add(id));
    } catch (_) { /* treat as no duplicates */ }
    return existing;
  }

  async createContact(auditor, payload) {
    await axios.post(
      `${auditor.apiEndpoint}/contacts`,
      payload,
      { headers: { Authorization: `Bearer ${auditor.apiKey}`, 'Content-Type': 'application/json' } }
    );
  }

  async fetchDeals(auditor) {
    const response = await axios.get(
      `${auditor.apiEndpoint}/deals?status=all&limit=1000`,
      { headers: { Authorization: `Bearer ${auditor.apiKey}` } }
    );
    return response.data.deals || response.data || [];
  }
}

class HubSpotAdapter {
  async checkDuplicates(auditor, identifiers) {
    const existing = new Set();
    for (const id of identifiers) {
      try {
        const res = await axios.get(
          `https://api.hubapi.com/crm/v3/objects/contacts/search`,
          {
            headers: { Authorization: `Bearer ${auditor.apiKey}` },
            params: { filterGroups: JSON.stringify([{ filters: [{ propertyName: 'external_id', operator: 'EQ', value: id.leadId }] }]) },
          }
        );
        if (res.data.total > 0) existing.add(id.leadId);
      } catch (_) {}
    }
    return existing;
  }

  async createContact(auditor, payload) {
    await axios.post(
      'https://api.hubapi.com/crm/v3/objects/contacts',
      { properties: payload },
      { headers: { Authorization: `Bearer ${auditor.apiKey}`, 'Content-Type': 'application/json' } }
    );
  }

  async fetchDeals(auditor) {
    const res = await axios.get(
      'https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=dealstage,closedate,amount,external_id,property_address',
      { headers: { Authorization: `Bearer ${auditor.apiKey}` } }
    );
    return (res.data.results || []).map(d => ({
      id:               d.id,
      external_id:      d.properties.external_id,
      property_address: d.properties.property_address,
      deal_status:      this._mapStage(d.properties.dealstage),
      close_date:       d.properties.closedate,
      amount:           parseFloat(d.properties.amount) || 0,
    }));
  }

  _mapStage(stage) {
    if (!stage) return 'open';
    const s = stage.toLowerCase();
    if (s.includes('won')  || s.includes('closed won'))  return 'won';
    if (s.includes('lost') || s.includes('closed lost')) return 'lost';
    return 'open';
  }
}

class GoHighLevelAdapter {
  async checkDuplicates(auditor, identifiers) {
    const existing = new Set();
    try {
      const res = await axios.get(
        `${auditor.apiEndpoint}/contacts/search`,
        {
          headers: { Authorization: `Bearer ${auditor.apiKey}` },
          params: { query: identifiers.map(i => i.leadId).join(',') },
        }
      );
      (res.data.contacts || []).forEach(c => {
        if (c.customField?.external_id) existing.add(c.customField.external_id);
      });
    } catch (_) {}
    return existing;
  }

  async createContact(auditor, payload) {
    await axios.post(
      `${auditor.apiEndpoint}/contacts/`,
      payload,
      { headers: { Authorization: `Bearer ${auditor.apiKey}`, 'Content-Type': 'application/json' } }
    );
  }

  async fetchDeals(auditor) {
    const res = await axios.get(
      `${auditor.apiEndpoint}/opportunities/?limit=100`,
      { headers: { Authorization: `Bearer ${auditor.apiKey}` } }
    );
    return (res.data.opportunities || []).map(o => ({
      id:               o.id,
      external_id:      o.customFields?.external_id,
      property_address: o.customFields?.property_address,
      deal_status:      o.status === 'won' ? 'won' : o.status === 'lost' ? 'lost' : 'open',
      close_date:       o.lastStatusChangeAt,
      amount:           o.monetaryValue || 0,
    }));
  }
}

module.exports = CRMAuditor;
