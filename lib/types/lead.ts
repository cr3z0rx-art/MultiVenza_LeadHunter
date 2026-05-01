export type LeadTier         = 'diamante' | 'oro' | 'plata'
export type LeadState        = 'FL' | 'GA' | 'IL' | 'TX' | 'AZ' | 'NC' | 'MIXED'
export type ProjectType      = 'Roofing' | 'Flooring' | 'HVAC' | 'New Construction' | 'CGC' | 'Remodel' | 'Home Builder'
export type RoofClass        = 'critical' | 'warm' | 'normal'

export interface Lead {
  id: string

  // ── Public fields ──────────────────────────────────────────────────────────
  city:                 string
  zip_code:             string | null
  state:                LeadState
  county:               string | null
  project_type:         ProjectType
  estimated_valuation:  number
  projected_profit:     number
  tier:                 LeadTier
  score:                number
  tags:                 string[]
  no_gc:                boolean
  roof_age:             number | null
  roof_classification:  RoofClass | null
  permit_status:        string | null
  permit_number:        string
  permit_date:          string | null
  government_source:    string | null
  market_note:          string | null
  created_at:           string

  // ── Unlock status ──────────────────────────────────────────────────────────
  is_unlocked:   boolean
  unlocked_at:   string | null

  // ── Protected fields (null when locked) ───────────────────────────────────
  exact_address:   string | null
  owner_name:      string | null
  phone:           string | null
  contractor_name: string | null
}

export interface LeadFilters {
  state?:        LeadState | 'all'
  county?:       string    | 'all'
  tier?:         LeadTier  | 'all'
  project_type?: ProjectType | 'all'
  min_valuation?: number
  max_valuation?: number
  no_gc_only?:   boolean
  search?:       string
}

/** Payload sent by Python scrapers to POST /api/sync */
export interface SyncPayload {
  leads: Array<{
    city:                string
    zip_code?:           string
    state:               LeadState
    county?:             string
    project_type:        ProjectType
    estimated_valuation: number
    projected_profit?:   number
    tier:                LeadTier
    score:               number
    tags?:               string[]
    no_gc?:              boolean
    roof_age?:           number
    roof_classification?: RoofClass
    permit_status?:      string
    market_note?:        string
    exact_address?:      string
    owner_name?:         string
    phone?:              string
    contractor_name?:    string
    permit_number:       string
    permit_date?:        string
    government_source?:  string
    processed_at?:       string
  }>
  competitors?: Array<{
    permitNumber: string
    state: string
    county?: string
    city?: string
    zipCode?: string
    contractorName: string
    projectType: string
    valuation: number
    permitDate?: string
  }>
  source_state: LeadState
  batch_id?:    string
}

export interface SyncResult {
  inserted: number
  updated:  number
  skipped:  number
  errors:   string[]
}

export interface DailyStats {
  tpv24h:    number
  count24h:  number
  profit24h: number
}
