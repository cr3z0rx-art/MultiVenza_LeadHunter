-- ============================================================
-- Migration 006 — Market Insights RPCs
-- Replaces 25-chunk fetchAll pattern with server-side aggregation.
-- Run in Supabase SQL Editor after deploying app code.
-- ============================================================

-- ── 1. VOLUME METRICS ────────────────────────────────────────────────────────
-- Returns the full VolumeMetrics object as JSON in a single pass.
-- totalPermits = GC permits (competitor_analysis, 90d) + No-GC leads (all time)
-- activeLeads  = all no_gc=true leads, any tier (direct owner access)
-- byState      = merged permit volume per state, sorted by total desc

CREATE OR REPLACE FUNCTION get_market_insights(p_cutoff TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_cutoff DATE;
  v_result JSON;
BEGIN
  v_cutoff := COALESCE(p_cutoff::DATE, CURRENT_DATE - INTERVAL '90 days');

  WITH
  comp_stats AS (
    SELECT
      COUNT(*)                       AS total_count,
      COALESCE(SUM(valuation), 0)    AS total_valuation
    FROM competitor_analysis
    WHERE permit_date >= v_cutoff
  ),
  leads_stats AS (
    SELECT
      COUNT(*)                                           AS total_count,
      COUNT(*) FILTER (WHERE no_gc = true)               AS no_gc_count
    FROM leads
  ),
  state_leads AS (
    SELECT
      state,
      COUNT(*)                                           AS permit_count,
      COUNT(*) FILTER (WHERE no_gc = true)               AS opp_count
    FROM leads
    WHERE state IS NOT NULL AND state NOT IN ('', 'Unknown')
    GROUP BY state
  ),
  state_comp AS (
    SELECT state, COUNT(*) AS permit_count
    FROM competitor_analysis
    WHERE permit_date >= v_cutoff
      AND state IS NOT NULL AND state != ''
    GROUP BY state
  ),
  state_combined AS (
    SELECT
      COALESCE(sl.state, sc.state)                       AS state,
      COALESCE(sl.permit_count, 0) + COALESCE(sc.permit_count, 0) AS permits,
      COALESCE(sl.opp_count, 0)                          AS opportunities
    FROM state_leads sl
    FULL OUTER JOIN state_comp sc ON sl.state = sc.state
    WHERE COALESCE(sl.state, sc.state) IS NOT NULL
  )
  SELECT json_build_object(
    'totalPermits',      cs.total_count + ls.total_count,
    'totalValuation90d', cs.total_valuation,
    'activeLeads',       ls.no_gc_count,
    'noGcRate',          CASE WHEN ls.total_count > 0
                         THEN ROUND((ls.no_gc_count::NUMERIC / ls.total_count) * 100)::INT
                         ELSE 0 END,
    'byState', (
      SELECT json_agg(
        json_build_object(
          'state',         state,
          'permits',       permits,
          'opportunities', opportunities
        ) ORDER BY permits DESC
      )
      FROM state_combined
    )
  )
  INTO v_result
  FROM comp_stats cs, leads_stats ls;

  RETURN v_result;
END;
$$;

-- ── 2. SATURATION ZONES ───────────────────────────────────────────────────────
-- Contractors with ≥ p_threshold permits in the same ZIP code (90d window).
-- Replaces fetchAll + JS group-by in getSaturationData().

CREATE OR REPLACE FUNCTION get_saturation_zones(
  p_threshold INT  DEFAULT 5,
  p_cutoff    TEXT DEFAULT NULL
)
RETURNS TABLE(
  contractor_name TEXT,
  zip_code        TEXT,
  city            TEXT,
  state           TEXT,
  permit_count    BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_cutoff DATE;
BEGIN
  v_cutoff := COALESCE(p_cutoff::DATE, CURRENT_DATE - INTERVAL '90 days');

  RETURN QUERY
  SELECT
    UPPER(TRIM(ca.contractor_name))  AS contractor_name,
    ca.zip_code,
    COALESCE(ca.city, '')            AS city,
    COALESCE(ca.state, '')           AS state,
    COUNT(*)                         AS permit_count
  FROM competitor_analysis ca
  WHERE ca.contractor_name IS NOT NULL
    AND ca.zip_code IS NOT NULL
    AND ca.permit_date >= v_cutoff
  GROUP BY UPPER(TRIM(ca.contractor_name)), ca.zip_code, ca.city, ca.state
  HAVING COUNT(*) >= p_threshold
  ORDER BY COUNT(*) DESC
  LIMIT 20;
END;
$$;

-- ── 3. ZIP HEAT MAP ───────────────────────────────────────────────────────────
-- Top p_limit ZIP codes by permit volume (90d). Returns pct relative to max.
-- Replaces fetchAll + JS group-by in getZipHeatData().
-- Bug fix: original code computed cutoff but never applied it to the query.

CREATE OR REPLACE FUNCTION get_zip_heat(
  p_cutoff TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 36
)
RETURNS TABLE(
  zip_code TEXT,
  city     TEXT,
  state    TEXT,
  count    BIGINT,
  pct      INT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_cutoff DATE;
BEGIN
  v_cutoff := COALESCE(p_cutoff::DATE, CURRENT_DATE - INTERVAL '90 days');

  RETURN QUERY
  WITH counts AS (
    SELECT
      ca.zip_code,
      MAX(ca.city)   AS city,
      MAX(ca.state)  AS state,
      COUNT(*)       AS cnt
    FROM competitor_analysis ca
    WHERE ca.zip_code IS NOT NULL
      AND ca.permit_date >= v_cutoff
    GROUP BY ca.zip_code
    ORDER BY cnt DESC
    LIMIT p_limit
  )
  SELECT
    zip_code,
    city,
    state,
    cnt::BIGINT                                                    AS count,
    ROUND((cnt::NUMERIC / NULLIF(MAX(cnt) OVER (), 0)) * 100)::INT AS pct
  FROM counts
  ORDER BY cnt DESC;
END;
$$;

-- ── 4. TERRITORY CONTROL ─────────────────────────────────────────────────────
-- City-level market share breakdown per contractor (90d window).
-- Returns top-10 contractors per city, cities with ≥ p_min_permits, capped at p_city_limit.
-- Replaces fetchAll + JS group-by in getTerritoryData().
-- Bug fix: original code computed cutoff but never applied it to the query.

CREATE OR REPLACE FUNCTION get_territory_control(
  p_min_permits INT  DEFAULT 5,
  p_city_limit  INT  DEFAULT 20,
  p_cutoff      TEXT DEFAULT NULL
)
RETURNS TABLE(
  zone      TEXT,
  state     TEXT,
  total     BIGINT,
  companies JSON
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_cutoff DATE;
BEGIN
  v_cutoff := COALESCE(p_cutoff::DATE, CURRENT_DATE - INTERVAL '90 days');

  RETURN QUERY
  WITH raw AS (
    SELECT
      TRIM(ca.city)                     AS zone,
      ca.state,
      UPPER(TRIM(ca.contractor_name))   AS gc,
      COUNT(*)                          AS cnt,
      COALESCE(SUM(ca.valuation), 0)    AS val
    FROM competitor_analysis ca
    WHERE ca.contractor_name IS NOT NULL
      AND ca.city IS NOT NULL AND ca.city != ''
      AND ca.permit_date >= v_cutoff
    GROUP BY TRIM(ca.city), ca.state, UPPER(TRIM(ca.contractor_name))
  ),
  city_totals AS (
    SELECT zone, SUM(cnt) AS total_cnt
    FROM raw
    GROUP BY zone
    HAVING SUM(cnt) >= p_min_permits
  ),
  ranked AS (
    SELECT
      r.zone, r.state, r.gc, r.cnt, r.val, ct.total_cnt,
      ROW_NUMBER() OVER (PARTITION BY r.zone ORDER BY r.cnt DESC) AS rn
    FROM raw r
    JOIN city_totals ct ON r.zone = ct.zone
  )
  SELECT
    r.zone,
    MAX(r.state)      AS state,
    MAX(r.total_cnt)  AS total,
    json_agg(
      json_build_object(
        'contractor_name', r.gc,
        'permits',         r.cnt,
        'valuation',       r.val,
        'share_pct',       ROUND((r.cnt::NUMERIC / r.total_cnt) * 100)::INT,
        'monopoly',        (r.cnt::NUMERIC / r.total_cnt) >= 0.20,
        'permits_per_mo',  ROUND((r.cnt::NUMERIC / 3) * 10) / 10
      ) ORDER BY r.cnt DESC
    )                 AS companies
  FROM ranked r
  WHERE r.rn <= 10
  GROUP BY r.zone
  ORDER BY MAX(r.total_cnt) DESC
  LIMIT p_city_limit;
END;
$$;

-- ── 5. MAP STATE DATA ─────────────────────────────────────────────────────────
-- Per-state aggregates for the US heatmap component.
-- Replaces 3× fetchAll in getMapData().

CREATE OR REPLACE FUNCTION get_map_state_data(p_cutoff TEXT DEFAULT NULL)
RETURNS TABLE(
  state      TEXT,
  permits90d BIGINT,
  diamante   BIGINT,
  overloaded BIGINT,
  stale      BIGINT,
  top_gc     TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_cutoff DATE;
BEGIN
  v_cutoff := COALESCE(p_cutoff::DATE, CURRENT_DATE - INTERVAL '90 days');

  RETURN QUERY
  WITH
  gc_ranked AS (
    SELECT
      state,
      UPPER(TRIM(contractor_name)) AS gc_name,
      COUNT(*)                     AS gc_cnt,
      ROW_NUMBER() OVER (
        PARTITION BY state ORDER BY COUNT(*) DESC
      )                            AS rn
    FROM competitor_analysis
    WHERE contractor_name IS NOT NULL
      AND state IS NOT NULL AND state != ''
      AND permit_date >= v_cutoff
    GROUP BY state, UPPER(TRIM(contractor_name))
  ),
  comp_by_state AS (
    SELECT
      state,
      COUNT(*) AS permit_count
    FROM competitor_analysis
    WHERE state IS NOT NULL AND state != ''
      AND permit_date >= v_cutoff
    GROUP BY state
  ),
  top_gc_by_state AS (
    SELECT state, gc_name AS top_gc FROM gc_ranked WHERE rn = 1
  ),
  overloaded_by_state AS (
    SELECT state, COUNT(*) AS overloaded_count
    FROM (
      SELECT state, UPPER(TRIM(contractor_name)) AS gc_name, COUNT(*) AS cnt
      FROM competitor_analysis
      WHERE contractor_name IS NOT NULL
        AND state IS NOT NULL
        AND permit_date >= v_cutoff
      GROUP BY state, UPPER(TRIM(contractor_name))
      HAVING COUNT(*) >= 15
    ) sub
    GROUP BY state
  ),
  diamante_by_state AS (
    SELECT state, COUNT(*) AS diamante_count
    FROM leads
    WHERE (tier = 'diamante' OR no_gc = true)
      AND state IS NOT NULL AND state != ''
    GROUP BY state
  ),
  stale_by_state AS (
    SELECT state, COUNT(*) AS stale_count
    FROM leads
    WHERE permit_date IS NOT NULL
      AND permit_date::DATE <= CURRENT_DATE - INTERVAL '30 days'
      AND state IS NOT NULL AND state != ''
      AND (
        permit_status IS NULL
        OR NOT (
          permit_status ILIKE '%final%'
          OR permit_status ILIKE '%closed%'
          OR permit_status ILIKE '%completed%'
          OR permit_status ILIKE '%co issued%'
          OR permit_status ILIKE '%expired%'
        )
      )
    GROUP BY state
  )
  SELECT
    COALESCE(c.state, d.state, s.state)        AS state,
    COALESCE(c.permit_count, 0)                AS permits90d,
    COALESCE(d.diamante_count, 0)              AS diamante,
    COALESCE(o.overloaded_count, 0)            AS overloaded,
    COALESCE(s.stale_count, 0)                 AS stale,
    t.top_gc
  FROM comp_by_state c
  FULL OUTER JOIN diamante_by_state d   ON c.state = d.state
  FULL OUTER JOIN overloaded_by_state o ON COALESCE(c.state, d.state) = o.state
  FULL OUTER JOIN stale_by_state s      ON COALESCE(c.state, d.state) = s.state
  LEFT  JOIN top_gc_by_state t          ON COALESCE(c.state, d.state) = t.state
  WHERE COALESCE(c.state, d.state, s.state) IS NOT NULL;
END;
$$;

-- ── 6. RESCUE LEADS ───────────────────────────────────────────────────────────
-- Active permits stale ≥ p_stale_days (not finaled/closed).
-- No-GC leads sort first, then by permit_date ASC (oldest = most urgent).
-- Replaces client-side filter over 5000-row JS fetch in getRescueLeads().

CREATE OR REPLACE FUNCTION get_rescue_leads(
  p_stale_days INT DEFAULT 30,
  p_limit      INT DEFAULT 20
)
RETURNS TABLE(
  id             UUID,
  city           TEXT,
  state          TEXT,
  project_type   TEXT,
  permit_number  TEXT,
  permit_date    TEXT,
  permit_status  TEXT,
  no_gc          BOOLEAN,
  tier           TEXT,
  days_stale     INT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id::UUID,
    COALESCE(l.city, '')           AS city,
    COALESCE(l.state, '')          AS state,
    COALESCE(l.project_type, '')   AS project_type,
    COALESCE(l.permit_number, '')  AS permit_number,
    l.permit_date::TEXT            AS permit_date,
    l.permit_status::TEXT,
    COALESCE(l.no_gc, false)       AS no_gc,
    COALESCE(l.tier, 'plata')      AS tier,
    (CURRENT_DATE - l.permit_date::DATE)::INT AS days_stale
  FROM leads l
  WHERE l.permit_date IS NOT NULL
    AND l.permit_date::DATE <= CURRENT_DATE - (p_stale_days || ' days')::INTERVAL
    AND (
      l.permit_status IS NULL
      OR NOT (
        l.permit_status ILIKE '%final%'
        OR l.permit_status ILIKE '%closed%'
        OR l.permit_status ILIKE '%completed%'
        OR l.permit_status ILIKE '%co issued%'
        OR l.permit_status ILIKE '%expired%'
      )
    )
  ORDER BY l.no_gc DESC, l.permit_date ASC
  LIMIT p_limit;
END;
$$;

-- ── Grants (service_role bypasses RLS, but anon/authenticated need explicit grants) ──
GRANT EXECUTE ON FUNCTION get_market_insights(TEXT)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_saturation_zones(INT, TEXT)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_zip_heat(TEXT, INT)                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_territory_control(INT, INT, TEXT)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_map_state_data(TEXT)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_rescue_leads(INT, INT)                   TO anon, authenticated;
