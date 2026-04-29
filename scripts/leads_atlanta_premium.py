#!/usr/bin/env python3
"""
scripts/leads_atlanta_premium.py

Extractor de leads premium para Atlanta (Fulton y Gwinnett Counties)
con "Filtro de Hierro" (valuation > $15,000) y enfoque en nichos prioritarios.

Utiliza drivers reales para:
- Fulton County: Accela ACA (accela_driver.js)
- Gwinnett County: Tyler EnerGov (energov_driver.js)

Uso:
  python scripts/leads_atlanta_premium.py [--days=30] [--max=500]
"""

import argparse
import json
import os
import re
import sys
import csv
from datetime import datetime
from pathlib import Path
import subprocess

sys.path.append(str(Path(__file__).parent))
from financials import calculate_financials
from saas_sync import sync_ga_leads

CONFIG_FILE = Path("config_atlanta_premium.json")
OUTPUT_DIR = Path("output")
DRIVERS_DIR = Path(__file__).parent / "drivers"

# ─── LLC / Persona detection ──────────────────────────────────────────────────

_LLC_SUFFIXES = re.compile(
    r'\b(LLC|INC|CORP|CO|LTD|LP|LLP|PLLC|PC|PA|'
    r'PROPERTIES|HOLDINGS|INVESTMENTS|ENTERPRISES|GROUP|REALTY|'
    r'DEVELOPMENT|DEVELOPERS|MANAGEMENT|CONSTRUCTION|BUILDERS?|'
    r'SERVICES?|SOLUTIONS?|ASSOCIATES?|PARTNERS?|TRUST|FUND)\b',
    re.IGNORECASE,
)

_FAKE_NAMES = {
    "OWNER 0", "OWNER 1", "OWNER 2", "OWNER 3", "OWNER 4",
    "OWNER 5", "OWNER 6", "OWNER 7", "OWNER 8", "OWNER 9",
    "GWINNETT CLIENT", "CHICAGO CLIENT", "FULTON CLIENT", "ATLANTA CLIENT",
    "", "PENDING VERIFICATION", "N/A", "UNKNOWN",
}


def is_fake_owner(name: str) -> bool:
    return not name or name.strip().upper() in _FAKE_NAMES


def classify_owner(name: str) -> str:
    """Retorna 'LLC' si el nombre parece una entidad corporativa, 'PERSON' si no."""
    if not name or is_fake_owner(name):
        return "UNKNOWN"
    if _LLC_SUFFIXES.search(name):
        return "LLC"
    return "PERSON"


def build_phone_strategy(owner_name: str, owner_type: str, address: str, city: str) -> dict:
    """
    Para LLCs: prepara query para Outscraper/Google Maps Places API.
    Para Personas: prepara URL del Tax Assessor de Fulton/Gwinnett para cruce manual.
    """
    if owner_type == "LLC":
        query = f"{owner_name} {city} GA"
        return {
            "strategy": "OUTSCRAPER_GOOGLE_MAPS",
            "query": query,
            "note": "Buscar teléfono comercial vía Outscraper Google Maps API",
            "outscraper_query": query,
        }
    elif owner_type == "PERSON":
        county = "Gwinnett" if "GWINNETT" in city.upper() else "Fulton"
        if county == "Fulton":
            tax_url = f"https://qpublic.schneidercorp.com/Application.aspx?AppID=1025&LayerID=22381&PageTypeID=2&PageID=9436&Q=1879773799&KeyValue={address.replace(' ', '%20')}"
        else:
            tax_url = f"https://www.gwinnettassessor.manatron.com/IAS/Searching/CommonSearch.aspx?mode=ADDRESS"
        return {
            "strategy": "TAX_ASSESSOR_SKIP_TRACE",
            "note": f"Cruzar con Tax Assessor {county} County para nombre real, luego BatchData skip trace",
            "tax_assessor_county": county,
            "tax_assessor_url": tax_url,
        }
    else:
        return {
            "strategy": "PENDING",
            "note": "Sin nombre de propietario real — marcar para verificación manual",
        }


# ─── Config ───────────────────────────────────────────────────────────────────

def load_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {
            "region": {"counties": ["Fulton", "Gwinnett"]},
            "filters": {
                "ironFilter": {"thresholdValuation": 15000},
                "priorityNiches": {
                    "keywords": [
                        "NEW CONSTRUCTION", "ADDITION", "RE-ROOF",
                        "REROOF", "BASEMENT FINISH", "INTERIOR REMODEL",
                        "SOLAR", "COMMERCIAL",
                    ]
                },
            },
            "financials": {"netProfitRate": 0.35},
            "extraction": {"maxDays": 30, "fallbackToStub": False},
        }


# ─── Driver execution ─────────────────────────────────────────────────────────

def run_driver(driver_name, county, days, max_items):
    driver_path = DRIVERS_DIR / f"{driver_name}_driver.js"
    if not driver_path.exists():
        print(f"Error: Driver {driver_name} no encontrado en {driver_path}")
        return []

    temp_script = DRIVERS_DIR / f"run_{driver_name}_{county.lower()}.js"

    with open(temp_script, "w", encoding="utf-8") as f:
        f.write(f"""'use strict';
const {driver_name.capitalize()}Driver = require('./{driver_name}_driver.js');
const fs = require('fs');
const path = require('path');

let config;
try {{
  config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config_atlanta_premium.json'), 'utf8'));
}} catch (err) {{
  config = {{ extraction: {{ sources: {{ {county}: {{}} }}, fallbackToStub: false }} }};
}}

async function main() {{
  const driverConfig = config.extraction.sources['{county}'] || {{}};
  driverConfig.fallbackToStub = false;
  const driver = new {driver_name.capitalize()}Driver(driverConfig);
  try {{
    await driver.initialize();
    const permits = await driver.extractPermits({{ days: {days}, maxItems: {max_items} }});
    const outputPath = path.join(process.cwd(), 'output', 'temp_{county.lower()}_{driver_name}_permits.json');
    fs.writeFileSync(outputPath, JSON.stringify(permits, null, 2));
    console.log(`Extracción completada: ${{permits.length}} permisos`);
    if (config.filters?.contractorHistory?.enabled) {{
      const contractors = new Set();
      const contractorHistory = [];
      for (const permit of permits) {{
        if (permit.contractorId && !contractors.has(permit.contractorId) && contractors.size < 5) {{
          contractors.add(permit.contractorId);
          const history = await driver.extractContractorHistory(permit.contractorId);
          if (history.length > 0) contractorHistory.push({{ contractorId: permit.contractorId, contractorName: permit.contractorName, projects: history }});
        }}
      }}
      if (contractorHistory.length > 0) {{
        fs.writeFileSync(path.join(process.cwd(), 'output', 'temp_{county.lower()}_contractor_history.json'), JSON.stringify(contractorHistory, null, 2));
      }}
    }}
  }} catch (error) {{
    console.error(`Error: ${{error.message}}`);
    process.exit(1);
  }} finally {{
    await driver.close();
  }}
}}
main().catch(err => {{ console.error(err.message); process.exit(1); }});
""")

    try:
        result = subprocess.run(["node", str(temp_script)], capture_output=True, text=True, check=True)
        print(result.stdout)
        temp_output = OUTPUT_DIR / f"temp_{county.lower()}_{driver_name}_permits.json"
        if temp_output.exists():
            with open(temp_output, "r", encoding="utf-8") as f:
                permits = json.load(f)
            temp_output.unlink()
            return permits
        return []
    except subprocess.CalledProcessError as e:
        print(f"Error ejecutando driver {driver_name} para {county}:")
        print(f"STDOUT: {e.stdout}")
        print(f"STDERR: {e.stderr}")
        return []
    finally:
        if temp_script.exists():
            temp_script.unlink()


# ─── Processing ───────────────────────────────────────────────────────────────

def process_permits(permits, config):
    iron_threshold = config["filters"]["ironFilter"]["thresholdValuation"]
    priority_keywords = config["filters"]["priorityNiches"]["keywords"]

    processed = []
    stats = {"filtered_valuation": 0, "total_input": len(permits)}

    for permit in permits:
        valuation = float(permit.get("valuation", 0) or 0)

        # Filtro de Hierro GA: > $15,000
        if valuation <= iron_threshold:
            stats["filtered_valuation"] += 1
            continue

        # Datos del propietario
        raw_owner = (permit.get("ownerName") or "").strip()
        owner_name = raw_owner if not is_fake_owner(raw_owner) else "Pending Verification"
        owner_type = classify_owner(owner_name) if owner_name != "Pending Verification" else "UNKNOWN"

        permit_type = permit.get("permitType", "")
        description = permit.get("description", "")

        # Nicho y financials (GA: TPV × 1.3, tasa nicho)
        financials = calculate_financials(
            valuation=valuation,
            state="GA",
            city=permit.get("city", ""),
            permit_type=permit_type,
            description=description,
        )

        niche_category = financials["niche_category"]
        is_priority = any(kw.upper() in f"{permit_type} {description}".upper() for kw in priority_keywords)
        tier = "HIGH-TICKET" if is_priority else "STANDARD"

        # Estrategia de contacto según tipo de propietario
        phone_strategy = build_phone_strategy(
            owner_name=owner_name,
            owner_type=owner_type,
            address=permit.get("address", ""),
            city=permit.get("city", ""),
        )

        processed.append({
            "leadId": f"GA-{permit.get('county', '')}-{permit.get('permitNumber', '')}",
            "state": "GA",
            "county": permit.get("county", ""),
            "city": permit.get("city", ""),
            "permitNumber": permit.get("permitNumber", ""),
            "permitType": permit_type,
            "description": description,
            "permitDate": permit.get("permitDate", ""),
            "status": permit.get("status", ""),
            "address": permit.get("address", ""),
            "valuation": valuation,
            "tpv": financials["tpv"],
            "net_profit": financials["net_profit"],
            "niche_category": niche_category,
            "niche_rate_pct": f"{financials['niche_rate']:.0%}",
            "market_note": financials["market_note"],
            "tier": tier,
            "tags": ", ".join(["GA", "PREMIUM"] + (["HIGH-TICKET"] if is_priority else [])),
            "contractorName": permit.get("contractorName", ""),
            "contractorId": permit.get("contractorId", ""),
            "ownerName": owner_name,
            "ownerType": owner_type,
            "phone": "",                           # Se llenará vía Outscraper o skip tracing
            "phoneStrategy": phone_strategy["strategy"],
            "phoneNote": phone_strategy.get("note", ""),
            "outscraperQuery": phone_strategy.get("outscraper_query", ""),
            "taxAssessorUrl": phone_strategy.get("tax_assessor_url", ""),
            "source": permit.get("source", ""),
            "processedAt": datetime.now().isoformat(),
        })

    stats["total_output"] = len(processed)
    return processed, stats


# ─── Output ───────────────────────────────────────────────────────────────────

def write_outputs(leads, date_str):
    if not leads:
        print("No hay leads que cumplan con el Filtro de Hierro")
        return

    OUTPUT_DIR.mkdir(exist_ok=True)

    json_path = OUTPUT_DIR / f"leads_atlanta_premium_{date_str}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(leads, f, indent=2, ensure_ascii=False)

    csv_path = OUTPUT_DIR / f"leads_atlanta_premium_{date_str}.csv"
    fieldnames = [
        "leadId", "state", "county", "city",
        "permitNumber", "permitType", "description", "permitDate", "status",
        "address", "valuation", "tpv", "net_profit",
        "niche_category", "niche_rate_pct", "market_note",
        "tier", "tags",
        "contractorName", "contractorId",
        "ownerName", "ownerType",
        "phone", "phoneStrategy", "phoneNote", "outscraperQuery", "taxAssessorUrl",
        "source", "processedAt",
    ]

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(leads)

    print(f"\nResultados guardados:")
    print(f"  JSON: {json_path}")
    print(f"  CSV:  {csv_path}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Extractor de leads premium para Atlanta")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--max", type=int, default=500)
    args = parser.parse_args()

    print("=" * 80)
    print("  LEADS ATLANTA PREMIUM — MULTIVENZA LEADHUNTER v3.0")
    print("=" * 80)
    print(f"  Filtro de Hierro : > $15,000")
    print(f"  Modelo GA        : TPV = valuación × 1.3")
    print(f"  Profit por nicho : ROOFING/SOLAR 40% · COMMERCIAL/NEW CONST 25%")
    print(f"                     REMODELING/BASEMENT/ADDITION 32% · OTHER 30%")
    print(f"  Período          : {args.days} días · Máx: {args.max} por condado")
    print(f"  Stub data        : DESACTIVADO — solo datos reales")
    print("-" * 80)

    config = load_config()
    config["extraction"]["fallbackToStub"] = False

    all_permits = []

    print("\nExtrayendo Fulton County (Accela ACA)...")
    fulton = run_driver("accela", "Fulton", args.days, args.max)
    print(f"  {len(fulton)} permisos obtenidos")
    all_permits.extend(fulton)

    print("\nExtrayendo Gwinnett County (Tyler EnerGov)...")
    gwinnett = run_driver("energov", "Gwinnett", args.days, args.max)
    print(f"  {len(gwinnett)} permisos obtenidos")
    all_permits.extend(gwinnett)

    print(f"\nAplicando Filtro de Hierro y cálculos de mercado real...")
    leads, stats = process_permits(all_permits, config)

    # Estadísticas
    print(f"\n{'─'*60}")
    print(f"  Total input        : {stats['total_input']}")
    print(f"  Filtrados (<$15k)  : {stats['filtered_valuation']}")
    print(f"  Leads válidos      : {stats['total_output']}")

    # Por condado
    by_county: dict = {}
    for lead in leads:
        c = lead["county"]
        if c not in by_county:
            by_county[c] = {"count": 0, "tpv": 0.0, "net_profit": 0.0}
        by_county[c]["count"] += 1
        by_county[c]["tpv"] += lead["tpv"]
        by_county[c]["net_profit"] += lead["net_profit"]

    for county, s in by_county.items():
        print(f"  {county:<12} : {s['count']} leads · TPV ${s['tpv']:>12,.0f} · Net Profit ${s['net_profit']:>10,.0f}")

    # Por nicho
    by_niche: dict = {}
    for lead in leads:
        n = lead["niche_category"]
        by_niche[n] = by_niche.get(n, 0) + 1
    print(f"\n  Leads por nicho:")
    for niche, count in sorted(by_niche.items(), key=lambda x: -x[1]):
        print(f"    {niche:<20} : {count}")

    # Por tipo de propietario
    by_owner_type: dict = {}
    for lead in leads:
        ot = lead["ownerType"]
        by_owner_type[ot] = by_owner_type.get(ot, 0) + 1
    print(f"\n  Tipo de propietario:")
    for ot, count in by_owner_type.items():
        strategy = "Outscraper Google Maps" if ot == "LLC" else ("Tax Assessor + BatchData" if ot == "PERSON" else "Verificación manual")
        print(f"    {ot:<10} : {count} → {strategy}")

    print(f"{'─'*60}")

    date_str = datetime.now().strftime("%Y-%m-%d")
    write_outputs(leads, date_str)

    # ── Sync to SaaS API ────────────────────────────────────────────────────────
    sync_ga_leads(leads, batch_id=f"GA-{date_str}")

    print("\nProceso completado.")


if __name__ == "__main__":
    main()
