"""
scripts/saas_sync.py

Módulo compartido: sincroniza leads GA al SaaS API (POST /api/sync).
Importar desde leads_atlanta_premium.py via:
    sys.path.append(str(Path(__file__).parent))
    from saas_sync import sync_ga_leads

Variables de entorno requeridas:
    SAAS_API_URL   — URL base de la app (ej: https://tu-app.vercel.app)
    SAAS_API_KEY   — Clave secreta configurada en el SaaS (.env SYNC_API_KEY)

Opcional:
    SAAS_SCRAPER_SOURCE — string identificador del scraper (default: multivenza-ga)
"""

import json
import os
import urllib.request
import urllib.error
from datetime import datetime
from typing import Any, Dict, List, Optional

# Carga .env si python-dotenv está instalado
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

SAAS_API_URL    = os.getenv("SAAS_API_URL", "").rstrip("/")
SAAS_API_KEY    = os.getenv("SAAS_API_KEY", "")
SCRAPER_SOURCE  = os.getenv("SAAS_SCRAPER_SOURCE", "multivenza-ga")

# Mapeo de niche_category (GA) → project_type del SaaS
_NICHE_MAP: Dict[str, str] = {
    "ROOFING":            "Roofing",
    "NEW_CONSTRUCTION":   "New Construction",
    "COMMERCIAL":         "CGC",
    "REMODELING":         "Remodel",
    "SOLAR":              "Remodel",
    "BASEMENT":           "Remodel",
    "BASEMENT_FINISHING": "Remodel",
    "ADDITION":           "New Construction",
    "HVAC":               "HVAC",
    "OTHER":              "Remodel",
}

# Nombres placeholder que NO deben enviarse como owner_name real
_FAKE_NAMES = frozenset({
    "", "N/A", "NONE", "UNKNOWN", "PENDING VERIFICATION",
    "GWINNETT CLIENT", "FULTON CLIENT", "ATLANTA CLIENT",
})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tier(tpv: float) -> str:
    """Diamond si TPV > $15k (regla del SaaS)."""
    if tpv > 15_000:
        return "diamond"
    if tpv > 5_000:
        return "premium"
    return "standard"


def _score(lead: Dict[str, Any]) -> int:
    """Score 0-100 derivado de los datos disponibles en leads GA."""
    s = 10
    tpv = float(lead.get("tpv") or lead.get("valuation") or 0)

    niche = (lead.get("niche_category") or "").upper()
    if "ROOF" in niche:
        s += 20
    elif "COMMERCIAL" in niche or "CGC" in niche:
        s += 15
    elif "NEW_CONSTRUCTION" in niche or "ADDITION" in niche:
        s += 10

    no_gc = not bool(
        (lead.get("contractorName") or "").strip() or
        (lead.get("contractorId")   or "").strip()
    )
    if no_gc:
        s += 40

    if tpv > 250_000:
        s += 15
    elif tpv > 50_000:
        s += 10
    elif tpv > 15_000:
        s += 5

    if lead.get("tier") == "HIGH-TICKET":
        s += 10

    return min(s, 100)


def _map_lead(lead: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Convierte un lead GA procesado al shape del SaaS API."""
    permit_number = (lead.get("leadId") or "").strip()
    if not permit_number:
        return None  # sin clave de deduplicación → omitir

    tpv = float(lead.get("tpv") or lead.get("valuation") or 0)

    niche        = (lead.get("niche_category") or "OTHER").upper().replace(" ", "_")
    project_type = _NICHE_MAP.get(niche, "Remodel")

    # Tags
    raw_tags  = lead.get("tags", "")
    tags: List[str] = (
        [t.strip() for t in raw_tags.split(",") if t.strip()]
        if isinstance(raw_tags, str) else list(raw_tags or [])
    )
    if "GA" not in tags:
        tags.insert(0, "GA")

    # Fecha de permiso normalizada a YYYY-MM-DD
    permit_date = lead.get("permitDate") or lead.get("permit_date")
    if permit_date and "T" in str(permit_date):
        permit_date = str(permit_date)[:10]

    # Owner — descartar nombres falsos
    owner = (lead.get("ownerName") or "").strip()
    owner = owner if owner.upper() not in _FAKE_NAMES else None

    no_gc = not bool(
        (lead.get("contractorName") or "").strip() or
        (lead.get("contractorId")   or "").strip()
    )

    return {
        "city":                lead.get("city") or "",
        "zip_code":            lead.get("zip")  or None,
        "state":               "GA",
        "county":              lead.get("county") or None,
        "project_type":        project_type,
        "estimated_valuation": tpv,
        "tier":                _tier(tpv),
        "score":               _score(lead),
        "tags":                tags,
        "no_gc":               no_gc,
        "roof_age":            None,
        "roof_classification": None,
        "permit_status":       lead.get("status") or None,
        "market_note":         lead.get("market_note") or None,
        "exact_address":       lead.get("address") or None,
        "owner_name":          owner,
        "phone":               lead.get("phone") or None,
        "contractor_name":     lead.get("contractorName") or None,
        "permit_number":       permit_number,
        "permit_date":         permit_date or None,
        "government_source":   lead.get("source") or "Accela ACA / Tyler EnerGov (GA)",
        "processed_at":        lead.get("processedAt") or datetime.now().isoformat(),
    }


def _post_json(url: str, payload: dict, extra_headers: dict) -> Optional[dict]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req  = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type",   "application/json; charset=utf-8")
    req.add_header("Content-Length", str(len(data)))
    for k, v in extra_headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[saas_sync] HTTP {e.code}: {body[:400]}")
        return None
    except Exception as exc:
        print(f"[saas_sync] Error de red: {exc}")
        return None


# ── Público ───────────────────────────────────────────────────────────────────

def sync_ga_leads(
    leads: List[Dict[str, Any]],
    batch_id: Optional[str] = None,
) -> Optional[dict]:
    """
    Sincroniza leads GA procesados al SaaS API.

    Args:
        leads:    Lista de dicts producidos por leads_atlanta_premium.py → process_permits()
        batch_id: Identificador del lote (default: GA-YYYY-MM-DD)

    Returns:
        Dict con {inserted, updated, skipped, errors} o None si hubo error de red.
    """
    if not SAAS_API_URL or not SAAS_API_KEY:
        print("[saas_sync] ⚠️  SAAS_API_URL o SAAS_API_KEY no configurados — sync omitido")
        print("            Agrega estas variables a tu .env para activar la sincronización")
        return None

    mapped = [m for lead in leads if (m := _map_lead(lead)) is not None]

    if not mapped:
        print("[saas_sync] No hay leads GA válidos para sincronizar (ninguno tiene leadId)")
        return None

    url     = f"{SAAS_API_URL}/api/sync"
    payload = {
        "source_state": "GA",
        "batch_id":     batch_id or f"GA-{datetime.now().strftime('%Y-%m-%d')}",
        "leads":        mapped,
    }

    print(f"\n[saas_sync] → Enviando {len(mapped)} leads GA a {url} ...")

    result = _post_json(url, payload, {
        "x-api-key":        SAAS_API_KEY,
        "x-scraper-source": SCRAPER_SOURCE,
    })

    if result:
        ins  = result.get("inserted", 0)
        upd  = result.get("updated",  0)
        skip = result.get("skipped",  0)
        errs = result.get("errors",   [])
        print(f"[saas_sync] ✅ GA sync: {ins} nuevos · {upd} actualizados · {skip} omitidos")
        if errs:
            print(f"[saas_sync] ⚠️  Errores parciales: {errs[:3]}")
    return result
