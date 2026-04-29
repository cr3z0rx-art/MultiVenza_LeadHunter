"""
scripts/run_property_intelligence.py

Property Intelligence Report — Top 5 Fast Cash Leads
======================================================
Genera LEADS_INTELLIGENCE_REPORT.csv con:
  - Purchase_Type    : tipo de propietario inferido del nombre (Warranty/Trust/Investor/Life Estate)
  - Deed_Search_URL  : link directo al Clerk OR para buscar deed manual
  - NOC_Filed        : "VERIFICAR" + URL directa al Clerk para buscar NOC (últimos 60 días)
  - NOC_Search_URL   : link pre-llenado para buscar NOC en Hillsborough OR
  - Competition_Level: análisis de competencia basado en patrones del permiso

FUENTE DE DATOS:
  Hillsborough County Official Records → publicaccess.hillsclerk.com/oripublicaccess/
  El sistema del Clerk es JavaScript-only (no tiene REST API pública).
  Este script genera los links directos para lookup manual en < 2 min por propiedad.

Uso:
  python scripts/run_property_intelligence.py
  python scripts/run_property_intelligence.py --top=10   # analizar top 10
  python scripts/run_property_intelligence.py --all      # todos los leads
"""

import csv
import sys
import os
import io
import urllib.parse
from pathlib import Path
from datetime import date, timedelta

# Force UTF-8 output on Windows to avoid cp1252 encoding errors
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# ─── Config ───────────────────────────────────────────────────────────────────

OUTPUT_DIR  = Path("output")
FAST_FILE   = OUTPUT_DIR / "FAST_CASH_PRIORITY.csv"
OUT_FILE    = OUTPUT_DIR / "LEADS_INTELLIGENCE_REPORT.csv"

TOP_N       = 5
ALL_FLAG    = "--all" in sys.argv
TOP_ARG     = next((a for a in sys.argv if a.startswith("--top=")), None)
if TOP_ARG:
    TOP_N = int(TOP_ARG.split("=")[1])
if ALL_FLAG:
    TOP_N = 9999

LINE = "-" * 72

# ─── Hillsborough Clerk OR URLs ───────────────────────────────────────────────

OR_BASE = "https://publicaccess.hillsclerk.com/oripublicaccess/"

def clerk_name_search_url(name: str, instrument_type: str = "") -> str:
    """
    URL pre-llenada para buscar en el sistema OR de Hillsborough.
    El sistema es JS/iframe — la URL base abre la página; el usuario
    pega el nombre en el campo de búsqueda (< 30 segundos).
    """
    # El sistema OR de Hillsborough no acepta parámetros GET en la URL base.
    # La única forma es abrir el portal y buscar manualmente.
    return OR_BASE

def clerk_folio_url(folio: str) -> str:
    """
    Link directo al HCPA para ver el historial de la propiedad.
    Desde ahí el usuario puede ir a 'Document History' → OR records.
    """
    if not folio:
        return "https://www.hcpafl.org/property-search"
    clean = folio.lstrip("0")
    return f"https://www.hcpafl.org/property-search#id={folio}"

def build_google_maps_url(address: str, city: str, zip_: str) -> str:
    q = urllib.parse.quote(f"{address}, {city}, FL {zip_}")
    return f"https://www.google.com/maps/search/?api=1&query={q}"

# ─── Purchase Type inference ──────────────────────────────────────────────────

def infer_purchase_type(owner: str, co_owner: str = "") -> tuple[str, str]:
    """
    Returns (purchase_type, deed_hint) based on owner name patterns.

    FL Recording Types:
      WARRANTY DEED       → regular arm's-length sale, seller guarantees title
      QUIT CLAIM DEED     → no title guarantee, common in family transfers / investors
      CERTIFICATE OF TITLE → post-foreclosure / court order
      TRUSTEE'S DEED      → sale from a trust
      SPECIAL WARRANTY    → investor/builder grade, limited guarantees
    """
    upper = (owner + " " + co_owner).upper()

    # Investor entities — likely Warranty Deed or QC (quick flip)
    if any(kw in upper for kw in [
        "LLC", " INC", " CORP", "CORPORATION", "HOLDINGS", "PROPERTIES",
        "INVESTMENTS", "ACQUISITION", "REALTY", "VENTURES", "CAPITAL",
        "ASSETS", "GROUP", "ENTERPRISES", "PARTNERS",
    ]):
        return ("INVESTOR_ENTITY", "Probable: Warranty Deed o Quit Claim Deed")

    # Life Estate — elderly owner, likely original purchase Warranty Deed
    if "LIFE ESTATE" in upper:
        return ("LIFE_ESTATE", "Probable: Warranty Deed original + Life Estate reservation")

    # Trust / Trustee
    if any(kw in upper for kw in ["TRUSTEE", "TRUST", "REVOCABLE", "IRREVOCABLE"]):
        return ("TRUST", "Probable: Trustee's Deed o Warranty Deed → Trust")

    # Individual — most likely standard Warranty Deed
    return ("INDIVIDUAL", "Probable: Warranty Deed (compra estándar residencial)")

# ─── Competition Level analysis ──────────────────────────────────────────────

def infer_competition(description: str, fast_cash_type: str, status: str) -> tuple[str, str]:
    """
    Infers competition level from permit description and status signals.
    """
    upper = (description or "").upper()
    signals = []
    level = "LOW"

    # Private Provider → owner hired a separate inspection company
    if "PRIVATE PROVIDER" in upper:
        signals.append("Private Provider contratado (inspecciones independientes)")
        level = "MEDIUM"

    # After-the-fact permit → work started without permit, possible contractor already in
    if "AFTER THE FACT" in upper or "ATF" in upper or "HC-CMP-" in upper:
        signals.append("Permiso after-the-fact → obra puede estar avanzada")
        level = "HIGH"

    # Revision status → changes requested, project complex
    if status and "REVISION" in status.upper():
        signals.append("Estado: Revision — proyecto en ajuste de planos")
        level = "MEDIUM" if level == "LOW" else level

    # "Awaiting Client Reply" → owner undecided, opportunity window open
    if status and "AWAITING" in status.upper():
        signals.append("Estado: Awaiting Client Reply — propietario indeciso, ventana abierta")
        level = "LOW"

    # Complete — work done
    if status and status.upper() == "COMPLETE":
        signals.append("Permiso COMPLETE — obra finalizada, lead frío")
        level = "DONE"

    # Multiple scope items → likely already has GC
    scope_count = upper.count("SCOPE") + upper.count("PHASE") + upper.count("STEP")
    if scope_count >= 2:
        signals.append(f"Descripción multi-fase ({scope_count} scopes) → probable GC activo")
        level = "HIGH" if level != "DONE" else "DONE"

    notes = "; ".join(signals) if signals else "Sin señales de competencia activa"
    return (level, notes)

# ─── NOC notes ────────────────────────────────────────────────────────────────

def noc_guidance(owner: str, permit_date: str) -> str:
    """
    Florida Statute 713.13: NOC must be recorded before first payment to contractor.
    For owner-builder permits: no NOC required (they ARE the contractor).
    For permits with a GC: NOC should exist in OR records within 30 days of permit.
    """
    upper = (owner or "").upper()
    desc_upper = ""

    # If all records from FAST_CASH are Tampa ArcGIS data → no contractor field
    # These are owner-builder / no-GC leads by definition
    return (
        "Buscar en OR bajo: Grantor = nombre propietario, "
        "Instrument = NOTICE OF COMMENCEMENT, "
        f"Fecha: últimos 60 días desde {permit_date}"
    )

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'='*72}")
    print("  PROPERTY INTELLIGENCE REPORT — MULTIVENZA LEADHUNTER")
    print(f"{'='*72}\n")

    if not FAST_FILE.exists():
        print(f"  ERROR: {FAST_FILE} no encontrado.")
        print("  Corre primero: node --use-system-ca scripts/run_fast_cash_extraction.js")
        return

    # Cargar leads
    with open(FAST_FILE, newline="", encoding="utf-8-sig") as f:
        all_leads = list(csv.DictReader(f))

    # Tomar top N por valuación (ya están ordenados en el CSV)
    leads = [l for l in all_leads if l.get("Owner_Name", "").strip()]  # con nombre verificado
    leads = leads[:TOP_N]

    print(f"  Fuente        : {FAST_FILE}")
    print(f"  Leads totales : {len(all_leads)}")
    print(f"  Con nombre OK : {len([l for l in all_leads if l.get('Owner_Name','').strip()])}")
    print(f"  Analizando    : top {len(leads)}\n")

    # ── Construir reporte ─────────────────────────────────────────────────────
    report_rows = []

    for i, lead in enumerate(leads, 1):
        owner      = lead.get("Owner_Name", "").strip()
        co_owner   = lead.get("Co_Owner", "").strip()
        address    = lead.get("Address", "").strip()
        city       = lead.get("City", "Tampa").strip()
        zip_       = lead.get("ZIP", "").strip()
        folio      = lead.get("Folio_HCPA", "").strip()
        permit_num = lead.get("Permit_Number", "").strip()
        permit_date= lead.get("Fecha_Permiso", "").strip()
        valuation  = lead.get("Valuation ($)", "").strip()
        fc_type    = lead.get("Fast_Cash_Type", "").strip()
        status     = lead.get("Status", "").strip()
        description= lead.get("Permit_Description", "").strip()
        pa_status  = lead.get("PA_Status", "").strip()

        # ── 1. Purchase Type ──────────────────────────────────────────────────
        purchase_type, deed_hint = infer_purchase_type(owner, co_owner)

        # ── 2. NOC guidance ───────────────────────────────────────────────────
        noc_note  = noc_guidance(owner, permit_date)
        noc_field = f"VERIFICAR MANUAL | {noc_note}"

        # ── 3. Competition Level ──────────────────────────────────────────────
        comp_level, comp_notes = infer_competition(description, fc_type, status)

        # ── 4. Search URLs ────────────────────────────────────────────────────
        deed_url   = OR_BASE
        noc_url    = OR_BASE
        hcpa_url   = clerk_folio_url(folio)
        gmaps_url  = build_google_maps_url(address, city, zip_)

        row = {
            "Rank":               i,
            "Permit_Number":      permit_num,
            "Fast_Cash_Type":     fc_type,
            "Owner_Name":         owner,
            "Co_Owner":           co_owner,
            "Address":            address,
            "City":               city,
            "ZIP":                zip_,
            "Folio_HCPA":         folio,
            "Valuation ($)":      valuation,
            "Net_Profit_35 ($)":  lead.get("Net_Profit_35 ($)", ""),
            "Permit_Date":        permit_date,
            "Permit_Status":      status,
            "Permit_Description": description[:120] + ("..." if len(description) > 120 else ""),
            # Intelligence columns
            "Purchase_Type":      purchase_type,
            "Deed_Hint":          deed_hint,
            "NOC_Filed":          noc_field,
            "Competition_Level":  comp_level,
            "Competition_Notes":  comp_notes,
            # Links para lookup manual (< 2 min por propiedad)
            "OR_Search_URL":      deed_url,
            "HCPA_Detail_URL":    hcpa_url,
            "Google_Maps_URL":    gmaps_url,
            "PA_Status":          pa_status,
        }
        report_rows.append(row)

    # ── Escribir CSV ──────────────────────────────────────────────────────────
    fieldnames = list(report_rows[0].keys()) if report_rows else []
    with open(OUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(report_rows)

    # ── Print terminal report ─────────────────────────────────────────────────
    print(LINE)
    print(f"  {'#':<3} {'Propietario':<30} {'Tipo':<18} {'Competencia':<10} {'Deed Hint'}")
    print(f"  {LINE}")

    for r in report_rows:
        rank   = str(r["Rank"]).ljust(3)
        owner  = r["Owner_Name"][:28].ljust(30)
        ptype  = r["Purchase_Type"][:16].ljust(18)
        comp   = r["Competition_Level"][:8].ljust(10)
        deed   = r["Deed_Hint"][:45]
        print(f"  {rank} {owner} {ptype} {comp} {deed}")

    print(f"\n  {LINE}")
    print(f"\n  RESUMEN DE INTELIGENCIA\n")

    # Conteo por Purchase_Type
    pt_count = {}
    cl_count = {}
    for r in report_rows:
        pt = r["Purchase_Type"]
        cl = r["Competition_Level"]
        pt_count[pt] = pt_count.get(pt, 0) + 1
        cl_count[cl] = cl_count.get(cl, 0) + 1

    print("  Por tipo de propietario:")
    for pt, n in sorted(pt_count.items(), key=lambda x: -x[1]):
        print(f"    {pt:<22} {n} leads")

    print("\n  Por nivel de competencia:")
    for cl, n in sorted(cl_count.items(), key=lambda x: -x[1]):
        icon = "[!]" if cl == "HIGH" else "[~]" if cl == "MEDIUM" else "[OK]" if cl == "LOW" else "[--]"
        print(f"    {cl:<10} {n} leads")

    print(f"\n  {LINE}")
    print(f"  Archivo generado: {OUT_FILE}")
    print(f"  Leads analizados: {len(report_rows)}\n")

    print(f"  INSTRUCCIONES — Verificación manual NOC + Deed (2 min/propiedad):")
    print(f"  {LINE}")
    print(f"  1. Abrir: {OR_BASE}")
    print(f"  2. Buscar por: Grantor Name = NOMBRE DEL PROPIETARIO")
    print(f"  3. Instrument Types a buscar:")
    print(f"       WARRANTY DEED     → compra normal")
    print(f"       QUIT CLAIM DEED   → transferencia/inversionista")
    print(f"       CERTIFICATE TITLE → post-foreclosure")
    print(f"       NOTICE OF COMMENCEMENT → si existe, hay GC contratado")
    print(f"  4. Para NOC: filtrar últimos 60 días")
    print(f"     Si el NOC lista un contractor diferente al dueño → HIGH COMPETITION")
    print(f"\n  PROPIEDADES A VERIFICAR (copiar nombres en el Clerk):\n")

    for r in report_rows:
        print(f"  [{r['Rank']}] {r['Owner_Name']}")
        print(f"      Dirección : {r['Address']}, Tampa FL {r['ZIP']}")
        print(f"      Folio     : {r['Folio_HCPA']}")
        print(f"      OR Search : {OR_BASE}")
        print(f"      HCPA      : {r['HCPA_Detail_URL']}")
        print()

    print(LINE + "\n")


if __name__ == "__main__":
    main()
