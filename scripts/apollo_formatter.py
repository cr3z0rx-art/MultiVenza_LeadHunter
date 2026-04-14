"""
apollo_formatter.py
Formatea leads de MultiVenza LeadHunter al esquema exacto de Apollo.io People API.

Documentación Apollo.io:
  POST https://api.apollo.io/v1/contacts
  Headers: X-Api-Key: {APOLLO_API_KEY}

Uso:
  python scripts/apollo_formatter.py                        # lee master JSON más reciente
  python scripts/apollo_formatter.py --file output/leads_florida_wc_all_2026-04-14.json
  python scripts/apollo_formatter.py --push                 # formatea + envía a Apollo.io
  python scripts/apollo_formatter.py --top 10               # solo los 10 mejores por score
"""

import json
import os
import sys
import glob
import argparse
from datetime import datetime

# ─── Apollo field mapping ──────────────────────────────────────────────────────

def format_for_apollo(lead: dict) -> dict:
    """
    Transforma un lead del formato MultiVenza al esquema de Apollo.io /v1/contacts.

    Campos requeridos por Apollo:
      first_name, last_name         — de ownerName (split por espacio)
      organization_name             — usamos ciudad + "Property Owner"
      title                         — derivado de la categoría del lead
      city, state, country          — del registro
      label_names                   — tags de scoring (PREMIUM, NO-GC, ROOF15, etc.)
      custom_fields                 — todos los campos propios de MultiVenza

    Referencia: https://apolloio.github.io/apollo-api-docs/?shell#people
    """

    # ── Nombre del propietario ────────────────────────────────────────────────
    owner_raw = (lead.get("ownerName") or "").strip()
    if owner_raw and owner_raw.lower() not in ("owner 1","owner 2","owner 3",
                                                "owner 4","owner 5","owner 6",
                                                "unknown",""):
        parts = owner_raw.split(None, 1)
        first_name = parts[0] if parts else ""
        last_name  = parts[1] if len(parts) > 1 else ""
    else:
        first_name = ""
        last_name  = ""   # pendiente skiptracing

    # ── Título según categoría ────────────────────────────────────────────────
    category = lead.get("category", "")
    title_map = {
        "roofing":      "Property Owner — Roofing Project",
        "cgc":          "Property Owner — Construction / Renovation",
        "homeBuilders": "Property Owner — New Home Construction",
    }
    title = title_map.get(category, "Property Owner")

    # ── Labels para Apollo (segmentación) ────────────────────────────────────
    flags  = lead.get("flags", {})
    labels = []
    if lead.get("tier") == "PREMIUM":
        labels.append("PREMIUM-FL-WEST")
    if flags.get("noGC"):
        labels.append("NO-GC")
    if flags.get("roofCritical"):
        labels.append("ROOF-CRITICAL-15YR")
    elif flags.get("roofWarm"):
        labels.append("ROOF-WARM-12YR")
    if flags.get("highValue"):
        labels.append("HIGH-VALUE")
    labels.append(f"SCORE-{lead.get('score', 0)}")
    labels.append(f"CATEGORY-{category.upper()}")
    labels.append("FL-WEST-COAST")

    # ── Dirección ─────────────────────────────────────────────────────────────
    city    = lead.get("city", "")
    state   = "FL"
    country = "United States"
    zip_c   = lead.get("zip", "")

    # ── Project value ─────────────────────────────────────────────────────────
    pv           = lead.get("projectValue", {})
    tpv          = pv.get("totalProjectValue", 0)
    net_profit   = pv.get("estNetProfit", 0)
    partner_share = pv.get("partnerShare", 0)

    # ── Custom fields (visibles en Apollo contact detail) ─────────────────────
    custom_fields = {
        "multivenza_lead_id":        lead.get("leadId", ""),
        "permit_number":             lead.get("permitNumber", ""),
        "permit_type":               (lead.get("permitType") or "")[:100],
        "permit_date":               lead.get("permitDate", ""),
        "permit_status":             lead.get("status", ""),
        "permit_address":            lead.get("address", ""),
        "permit_county":             lead.get("county", ""),
        "permit_zip":                zip_c,
        "lead_score":                lead.get("score", 0),
        "lead_tier":                 lead.get("tier", "STANDARD"),
        "lead_category":             category,
        "total_project_value_usd":   tpv,
        "est_net_profit_30_usd":     net_profit,
        "partner_share_35_usd":      partner_share,
        "market_note":               pv.get("marketNote", ""),
        "no_gc":                     "YES" if flags.get("noGC") else "NO",
        "roof_age_years":            (lead.get("roofAnalysis") or {}).get("age"),
        "roof_classification":       (lead.get("roofAnalysis") or {}).get("classification", ""),
        "data_source":               lead.get("source", ""),
        "processed_at":              lead.get("processedAt", ""),
        "multivenza_imported_at":    datetime.utcnow().isoformat() + "Z",
    }

    # ── Payload final Apollo ──────────────────────────────────────────────────
    apollo_contact = {
        "first_name":          first_name,
        "last_name":           last_name,
        "organization_name":   f"{city} Property Owner",
        "title":               title,
        "city":                city,
        "state":               state,
        "country":             country,
        "label_names":         labels,
        "custom_fields":       custom_fields,
        # Campos que se completan tras skiptracing:
        # "email":             "",
        # "phone_numbers":     [{"raw_number": "", "type": "mobile"}],
    }

    return apollo_contact


# ─── Batch formatter ───────────────────────────────────────────────────────────

def format_batch(leads: list, top_n: int = None) -> list:
    """Formatea una lista de leads. Filtra los que no tienen suficientes datos."""
    sorted_leads = sorted(leads, key=lambda l: l.get("score", 0), reverse=True)
    if top_n:
        sorted_leads = sorted_leads[:top_n]
    return [format_for_apollo(lead) for lead in sorted_leads]


# ─── Push a Apollo.io (requiere APOLLO_API_KEY en .env) ───────────────────────

def push_to_apollo(contacts: list, api_key: str, dry_run: bool = True):
    """Envía contactos a Apollo.io /v1/contacts (POST)."""
    import urllib.request
    import urllib.error

    url     = "https://api.apollo.io/v1/contacts"
    headers = {
        "Content-Type": "application/json",
        "X-Api-Key":    api_key,
        "Cache-Control": "no-cache",
    }

    results = {"pushed": 0, "failed": 0, "errors": []}

    for i, contact in enumerate(contacts):
        if dry_run:
            print(f"  [DRY RUN] #{i+1} — {contact.get('first_name','?')} {contact.get('last_name','?')} | {contact['custom_fields']['permit_address']}, {contact['city']}")
            results["pushed"] += 1
            continue

        payload = json.dumps({"contact": contact}).encode("utf-8")
        req     = urllib.request.Request(url, data=payload, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = json.loads(resp.read())
                print(f"  ✅ #{i+1} pushed — Apollo ID: {body.get('contact', {}).get('id', 'N/A')}")
                results["pushed"] += 1
        except urllib.error.HTTPError as e:
            err = e.read().decode()
            print(f"  ❌ #{i+1} failed — HTTP {e.code}: {err[:120]}")
            results["failed"] += 1
            results["errors"].append({"contact_idx": i, "error": err[:200]})

    return results


# ─── CLI ───────────────────────────────────────────────────────────────────────

def find_latest_master() -> str:
    files = sorted(glob.glob("output/leads_florida_wc_all_*.json"), reverse=True)
    if not files:
        raise FileNotFoundError("No master JSON found in ./output/. Run npm run diamond first.")
    return files[0]


def main():
    parser = argparse.ArgumentParser(description="MultiVenza → Apollo.io formatter")
    parser.add_argument("--file",  default=None,  help="Path al JSON de leads (default: más reciente)")
    parser.add_argument("--top",   type=int, default=None, help="Top N leads por score")
    parser.add_argument("--push",  action="store_true",    help="Enviar a Apollo.io (requiere APOLLO_API_KEY en .env)")
    parser.add_argument("--out",   default=None,           help="Guardar JSON formateado en archivo")
    args = parser.parse_args()

    # Cargar .env si existe
    env_path = os.path.join(os.path.dirname(__file__), "../.env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())

    # Cargar leads
    leads_file = args.file or find_latest_master()
    with open(leads_file, encoding="utf-8") as f:
        leads = json.load(f)

    print(f"\n  MultiVenza → Apollo.io Formatter")
    print(f"  Fuente : {leads_file}  ({len(leads)} leads)")
    print(f"  Top N  : {args.top or 'todos'}")
    print()

    # Formatear
    contacts = format_batch(leads, top_n=args.top)
    print(f"  Contactos formateados: {len(contacts)}")

    # Guardar si se pide
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(contacts, f, indent=2, ensure_ascii=False)
        print(f"  Guardado: {args.out}")

    # Mostrar preview (3 primeros)
    print("\n  Preview (primeros 3):\n")
    for c in contacts[:3]:
        cf = c["custom_fields"]
        print(f"    {c['first_name'] or '(pendiente)'} {c['last_name']} | {cf['permit_address']}, {c['city']}")
        print(f"    Labels: {', '.join(c['label_names'])}")
        print(f"    TPV: ${cf['total_project_value_usd']:,.0f}  |  Partner Share: ${cf['partner_share_35_usd']:,.0f}  |  Score: {cf['lead_score']}")
        print()

    # Push a Apollo
    if args.push:
        api_key = os.environ.get("APOLLO_API_KEY", "")
        if not api_key:
            print("  ⚠️  APOLLO_API_KEY no configurada en .env — corriendo en DRY RUN")
        dry = not api_key
        print(f"\n  {'[DRY RUN] ' if dry else ''}Enviando {len(contacts)} contactos a Apollo.io...\n")
        results = push_to_apollo(contacts, api_key, dry_run=dry)
        print(f"\n  Resultado: {results['pushed']} pushed, {results['failed']} failed")

    print()


if __name__ == "__main__":
    main()
