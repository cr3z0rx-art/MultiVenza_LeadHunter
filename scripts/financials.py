"""
scripts/financials.py

Fuente ÚNICA de verdad (Python) para el modelo financiero MultiVenza LeadHunter.

Constantes de negocio (v3.0 — GA Market Realism):
    - FL Net Profit Rate : 35% uniforme, piso PREMIUM $250k en ciudades premium
    - GA Contract Mult.  : 1.3× sobre valuación declarada (gap declarado vs. real)
    - GA Profit by Niche : ROOFING/SOLAR 40% · COMMERCIAL/NEW CONST 25%
                           REMODELING/BASEMENT/ADDITION 32% · OTHER 30%
    - IL Net Profit Rate : 35% uniforme
    - Golden Rule        : FL >= $10k · GA >= $15k · IL >= $15k

Equivalente JavaScript: src/utils/financials.js — ambas implementaciones DEBEN
permanecer sincronizadas.
"""

from __future__ import annotations

from typing import Optional, TypedDict


# ─── Constantes de negocio ────────────────────────────────────────────────────

NET_PROFIT_RATE_FL_IL: float = 0.35
PREMIUM_FLOOR: int = 250_000

# GA: el valor declarado al condado es solo materiales — el contrato real es ~30% mayor
GA_CONTRACT_MULTIPLIER: float = 1.3

GA_NICHE_PROFIT_RATES: dict[str, float] = {
    "ROOFING":          0.40,
    "SOLAR":            0.40,
    "COMMERCIAL":       0.25,
    "NEW_CONSTRUCTION": 0.25,
    "REMODELING":       0.32,
    "BASEMENT":         0.32,
    "ADDITION":         0.32,
}
GA_DEFAULT_PROFIT_RATE: float = 0.30

PREMIUM_CITIES: dict[str, set[str]] = {
    "FL": {"SIESTA KEY", "LONGBOAT KEY", "LAKEWOOD RANCH"},
    "GA": set(),
    "IL": set(),
}

GOLDEN_RULE_THRESHOLDS: dict[str, int] = {
    "FL": 10_000,
    "GA": 15_000,
    "IL": 15_000,
}


# ─── Tipos ────────────────────────────────────────────────────────────────────

class FinancialResult(TypedDict):
    tier: str               # "PREMIUM" | "STANDARD"
    tpv: float              # Total Project Value (ajustado por multiplicador y/o piso)
    net_profit: float       # tpv * niche_rate (o 35% para FL/IL)
    niche_category: str     # Categoría de nicho detectada (GA) o "N/A"
    niche_rate: float       # Tasa aplicada (GA nicho) o NET_PROFIT_RATE_FL_IL
    floor_applied: bool     # True si se aplicó piso PREMIUM de FL
    contract_multiplier_applied: bool  # True si se aplicó GA_CONTRACT_MULTIPLIER
    market_note: str
    rate: float             # Alias de niche_rate (backward compat)
    threshold: int
    passes_golden_rule: bool


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _normalize_city(city: Optional[str]) -> str:
    if not city:
        return ""
    return str(city).strip().upper()


def _normalize_state(state: Optional[str]) -> str:
    if not state:
        return ""
    return str(state).strip().upper()


def _to_float(val) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    try:
        return float(str(val).replace(",", "").replace("$", "").strip() or 0)
    except (TypeError, ValueError):
        return 0.0


# ─── Detección de nicho (GA) ──────────────────────────────────────────────────

_ROOFING_KEYWORDS = {"ROOF", "REROOF", "RE-ROOF", "SHINGLE", "TILE ROOF", "FLAT ROOF"}
_SOLAR_KEYWORDS   = {"SOLAR", "PHOTOVOLTAIC", "PV SYSTEM", "PV PANEL"}
_COMMERCIAL_KEYWORDS = {"COMMERCIAL", "RETAIL", "OFFICE", "WAREHOUSE", "MIXED USE",
                         "STRIP MALL", "TENANT IMPROVEMENT"}
_NEW_CONST_KEYWORDS  = {"NEW CONSTRUCTION", "NEW BUILD", "NEW SINGLE FAMILY",
                          "NEW HOME", "SFD NEW", "NEW RESIDENCE", "NEW DWELLING"}
_REMODEL_KEYWORDS    = {"REMODEL", "RENOVATION", "INTERIOR ALT", "ALTERATION",
                          "INTERIOR REMODEL", "KITCHEN", "BATHROOM"}
_BASEMENT_KEYWORDS   = {"BASEMENT", "BASEMENT FINISH", "BASEMENT COMPLETION"}
_ADDITION_KEYWORDS   = {"ADDITION", "ADDTN", "ROOM ADDITION", "GARAGE ADDITION",
                          "HOME ADDITION"}


def detect_niche_category(permit_type: str = "", description: str = "") -> str:
    """Detecta la categoría de nicho a partir del tipo de permiso y descripción.

    Retorna una de: ROOFING · SOLAR · COMMERCIAL · NEW_CONSTRUCTION ·
                    REMODELING · BASEMENT · ADDITION · OTHER
    """
    text = f"{permit_type} {description}".upper()

    for kw in _ROOFING_KEYWORDS:
        if kw in text:
            return "ROOFING"
    for kw in _SOLAR_KEYWORDS:
        if kw in text:
            return "SOLAR"
    # NEW_CONSTRUCTION antes que COMMERCIAL para evitar falsos positivos
    for kw in _NEW_CONST_KEYWORDS:
        if kw in text:
            return "NEW_CONSTRUCTION"
    for kw in _COMMERCIAL_KEYWORDS:
        if kw in text:
            return "COMMERCIAL"
    for kw in _BASEMENT_KEYWORDS:
        if kw in text:
            return "BASEMENT"
    for kw in _ADDITION_KEYWORDS:
        if kw in text:
            return "ADDITION"
    for kw in _REMODEL_KEYWORDS:
        if kw in text:
            return "REMODELING"
    return "OTHER"


def get_ga_profit_rate(niche_category: str) -> float:
    """Devuelve la tasa de profit para el nicho GA dado."""
    return GA_NICHE_PROFIT_RATES.get(niche_category, GA_DEFAULT_PROFIT_RATE)


# ─── API pública ──────────────────────────────────────────────────────────────

def is_premium_city(state: Optional[str], city: Optional[str]) -> bool:
    s = _normalize_state(state)
    c = _normalize_city(city)
    if not s or not c:
        return False
    return c in PREMIUM_CITIES.get(s, set())


def get_golden_rule_threshold(state: Optional[str]) -> int:
    s = _normalize_state(state)
    return GOLDEN_RULE_THRESHOLDS.get(s, 0)


def passes_golden_rule(valuation, state: Optional[str]) -> bool:
    threshold = get_golden_rule_threshold(state)
    val = _to_float(valuation)
    return val >= threshold


def calculate_financials(
    *,
    valuation,
    state: Optional[str],
    city: Optional[str] = None,
    permit_type: str = "",
    description: str = "",
) -> FinancialResult:
    """Calcula el modelo financiero completo de un lead.

    Para GA aplica:
      - TPV = valuation × GA_CONTRACT_MULTIPLIER (1.3)
      - Net Profit = TPV × tasa_de_nicho (variable por categoría)

    Para FL aplica:
      - TPV = max(valuation, PREMIUM_FLOOR) en ciudades PREMIUM
      - Net Profit = TPV × 35%

    Para IL:
      - TPV = valuation
      - Net Profit = TPV × 35%
    """
    val = max(0.0, _to_float(valuation))
    s = _normalize_state(state)

    floor_applied = False
    contract_multiplier_applied = False
    niche_category = "N/A"
    market_note = ""

    if s == "GA":
        niche_category = detect_niche_category(permit_type, description)
        niche_rate = get_ga_profit_rate(niche_category)
        tpv = round(val * GA_CONTRACT_MULTIPLIER, 2)
        contract_multiplier_applied = True
        net_profit = round(tpv * niche_rate, 2)
        tier = "STANDARD"
        market_note = (
            f"GA: valuación declarada ${val:,.0f} × {GA_CONTRACT_MULTIPLIER} "
            f"= TPV ${tpv:,.0f} | Nicho {niche_category} @ {niche_rate:.0%}"
        )
    else:
        niche_rate = NET_PROFIT_RATE_FL_IL
        premium = is_premium_city(s, city)
        tier = "PREMIUM" if premium else "STANDARD"
        floor_applied = premium and val < PREMIUM_FLOOR
        tpv = float(PREMIUM_FLOOR) if floor_applied else val
        net_profit = round(tpv * niche_rate, 2)
        if floor_applied:
            market_note = (
                f"Piso PREMIUM aplicado ({s}): valor declarado "
                f"${val:,.0f} → ${PREMIUM_FLOOR:,.0f}"
            )

    return FinancialResult(
        tier=tier,
        tpv=tpv,
        net_profit=net_profit,
        niche_category=niche_category,
        niche_rate=niche_rate,
        floor_applied=floor_applied,
        contract_multiplier_applied=contract_multiplier_applied,
        market_note=market_note,
        rate=niche_rate,
        threshold=get_golden_rule_threshold(s),
        passes_golden_rule=passes_golden_rule(val, s),
    )


# ─── Self-test ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    tests = [
        # (valuation, state, city, permit_type, exp_tier, exp_tpv, exp_niche, exp_np, passes_gold)
        (28_000,  "FL", "Siesta Key",   "",                   "PREMIUM",  250_000,  "N/A",             87_500.0, True),
        (925_000, "FL", "Siesta Key",   "",                   "PREMIUM",  925_000,  "N/A",            323_750.0, True),
        (18_500,  "FL", "Venice",       "",                   "STANDARD",  18_500,  "N/A",              6_475.0, True),
        (100_000, "GA", "Atlanta",      "ROOFING",            "STANDARD", 130_000,  "ROOFING",         52_000.0, True),
        (200_000, "GA", "Alpharetta",   "NEW CONSTRUCTION",   "STANDARD", 260_000,  "NEW_CONSTRUCTION",65_000.0, True),
        (80_000,  "GA", "Marietta",     "INTERIOR REMODEL",   "STANDARD", 104_000,  "REMODELING",      33_280.0, True),
        (60_000,  "GA", "Sandy Springs","BASEMENT FINISH",    "STANDARD",  78_000,  "BASEMENT",        24_960.0, True),
        (50_000,  "GA", "Duluth",       "ROOM ADDITION",      "STANDARD",  65_000,  "ADDITION",        20_800.0, True),
        (300_000, "GA", "Atlanta",      "COMMERCIAL BUILD",   "STANDARD", 390_000,  "COMMERCIAL",      97_500.0, True),
        (10_000,  "GA", "Atlanta",      "MISC",               "STANDARD",  13_000,  "OTHER",            3_900.0, False),
        (50_000,  "IL", "Chicago",      "",                   "STANDARD",  50_000,  "N/A",             17_500.0, True),
    ]

    print("─" * 90)
    print("  SELF-TEST: scripts/financials.py v3.0")
    print("─" * 90)

    all_pass = True
    for v, st, ci, pt, exp_tier, exp_tpv, exp_niche, exp_np, exp_gold in tests:
        r = calculate_financials(valuation=v, state=st, city=ci, permit_type=pt)
        ok = (
            r["tier"] == exp_tier
            and abs(r["tpv"] - exp_tpv) < 1
            and r["niche_category"] == exp_niche
            and abs(r["net_profit"] - exp_np) < 1
            and r["passes_golden_rule"] == exp_gold
        )
        all_pass = all_pass and ok
        sym = "✓" if ok else "✗"
        print(
            f"  [{sym}] {st} ${v:>8,} {ci:<15} {pt:<22} "
            f"→ tier={r['tier']:<8} tpv=${r['tpv']:>9,.0f} "
            f"nicho={r['niche_category']:<16} np=${r['net_profit']:>9,.2f} "
            f"gold={r['passes_golden_rule']}"
        )

    print("─" * 90)
    print(f"  RESULTADO: {'TODOS LOS TESTS PASAN ✓' if all_pass else 'FALLOS DETECTADOS ✗'}")
    print("─" * 90)
