#!/usr/bin/env python3
"""
scripts/consolidate_leads.py

Consolida leads de múltiples estados (FL, GA, IL) en un único archivo JSON
para el dashboard multi-estado.

Uso:
  python scripts/consolidate_leads.py
"""

import json
import os
import sys
import glob
from datetime import datetime
from pathlib import Path

# Importar financials.py para usar las constantes y funciones compartidas
sys.path.append(str(Path(__file__).parent))
from financials import calculate_financials, passes_golden_rule, GOLDEN_RULE_THRESHOLDS

# Constantes
OUTPUT_DIR = Path("output")
CONSOLIDATED_FILE = OUTPUT_DIR / "consolidated_leads.json"

def find_latest_file(pattern):
    """Encuentra el archivo más reciente que coincide con el patrón"""
    files = glob.glob(str(OUTPUT_DIR / pattern))
    if not files:
        return None
    return max(files, key=os.path.getmtime)

def load_json_file(file_path):
    """Carga un archivo JSON"""
    if not file_path or not os.path.exists(file_path):
        return []
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error cargando {file_path}: {e}")
        return []

def normalize_florida_leads(leads):
    """Normaliza leads de Florida al formato canónico"""
    normalized = []
    
    for lead in leads:
        try:
            # Verificar si cumple la Regla de Oro para FL
            valuation = float(lead.get("valuation", 0))
            if not passes_golden_rule(valuation, "FL"):
                continue
            
            # Calcular financials
            financials = calculate_financials(
                valuation=valuation,
                state="FL",
                city=lead.get("city", "")
            )
            
            # Normalizar al formato canónico
            normalized.append({
                "id": f"FL-{lead.get('permitNumber', '')}",
                "state": "FL",
                "county": lead.get("county", ""),
                "city": lead.get("city", ""),
                "tier": financials["tier"],
                "type": lead.get("category", "").upper(),
                "permit": lead.get("permitNumber", ""),
                "owner": lead.get("ownerName", "Unknown"),
                "address": lead.get("address", ""),
                "valuation": valuation,
                "tpv": financials["tpv"],
                "net_profit": financials["net_profit_35"],
                "phone": "",
                "status": lead.get("status", "Issued"),
                "permit_date": lead.get("permitDate", ""),
                "source": lead.get("source", "Florida LeadHunter")
            })
        except Exception as e:
            print(f"Error procesando lead FL: {e}")
    
    return normalized

def normalize_georgia_leads(leads):
    """Normaliza leads de Georgia al formato canónico"""
    normalized = []
    
    for lead in leads:
        try:
            # Verificar si cumple la Regla de Oro para GA
            valuation = float(lead.get("valuation", 0))
            if not passes_golden_rule(valuation, "GA"):
                continue
            
            # Calcular financials
            financials = calculate_financials(
                valuation=valuation,
                state="GA",
                city=lead.get("city", "")
            )
            
            # Determinar si es HIGH-TICKET
            is_high_ticket = lead.get("tier") == "HIGH-TICKET" or "HIGH-TICKET" in (lead.get("tags", []) if isinstance(lead.get("tags"), list) else [])
            
            # Normalizar al formato canónico
            normalized.append({
                "id": f"GA-{lead.get('permitNumber', '')}",
                "state": "GA",
                "county": lead.get("county", ""),
                "city": lead.get("city", ""),
                "tier": "HIGH-TICKET" if is_high_ticket else "STANDARD",
                "type": lead.get("permitType", "").upper(),
                "permit": lead.get("permitNumber", ""),
                "owner": lead.get("ownerName", "Unknown"),
                "address": lead.get("address", ""),
                "valuation": valuation,
                "tpv": financials["tpv"],
                "net_profit": financials["net_profit_35"],
                "phone": "",
                "status": lead.get("status", "Issued"),
                "permit_date": lead.get("permitDate", ""),
                "source": lead.get("source", "Georgia LeadHunter")
            })
        except Exception as e:
            print(f"Error procesando lead GA: {e}")
    
    return normalized

def normalize_chicago_leads(leads):
    """Normaliza leads de Chicago al formato canónico"""
    normalized = []
    
    for lead in leads:
        try:
            # Verificar si cumple la Regla de Oro para IL
            valuation = float(str(lead.get("Valuation", 0)).replace(",", ""))
            if not passes_golden_rule(valuation, "IL"):
                continue
            
            # Calcular financials
            financials = calculate_financials(
                valuation=valuation,
                state="IL",
                city=lead.get("City", "")
            )
            
            # Normalizar al formato canónico
            normalized.append({
                "id": f"IL-{lead.get('Permit_Number', '')}",
                "state": "IL",
                "county": lead.get("County", "Cook"),
                "city": lead.get("City", "Chicago"),
                "tier": "STANDARD",
                "type": lead.get("Fast_Cash_Type", "").upper(),
                "permit": lead.get("Permit_Number", ""),
                "owner": lead.get("Owner_Name", "Unknown"),
                "address": lead.get("Address", ""),
                "valuation": valuation,
                "tpv": financials["tpv"],
                "net_profit": financials["net_profit_35"],
                "phone": "",
                "status": lead.get("Status", "Active"),
                "permit_date": lead.get("Fecha_Permiso", ""),
                "source": "Chicago LeadHunter"
            })
        except Exception as e:
            print(f"Error procesando lead IL: {e}")
    
    return normalized

def dedup_leads(leads):
    """Deduplica leads por clave compuesta (state + permit)"""
    seen = set()
    unique_leads = []
    
    for lead in leads:
        # Crear clave compuesta
        key = f"{lead['state']}:{lead['permit']}"
        
        if key not in seen:
            seen.add(key)
            unique_leads.append(lead)
    
    duplicates = len(leads) - len(unique_leads)
    if duplicates > 0:
        print(f"Eliminados {duplicates} leads duplicados")
    
    return unique_leads

def calculate_stats(leads):
    """Calcula estadísticas por estado"""
    stats = {
        "FL": {"count": 0, "tpv": 0, "net_profit": 0, "premium": 0},
        "GA": {"count": 0, "tpv": 0, "net_profit": 0, "premium": 0},
        "IL": {"count": 0, "tpv": 0, "net_profit": 0, "premium": 0}
    }
    
    for lead in leads:
        state = lead["state"]
        if state not in stats:
            continue
        
        stats[state]["count"] += 1
        stats[state]["tpv"] += lead["tpv"]
        stats[state]["net_profit"] += lead["net_profit"]
        
        if lead["tier"] in ["PREMIUM", "HIGH-TICKET"]:
            stats[state]["premium"] += 1
    
    return stats

def main():
    print("=" * 80)
    print("  CONSOLIDACIÓN DE LEADS MULTI-ESTADO - MULTIVENZA LEADHUNTER")
    print("=" * 80)
    
    # Encontrar los archivos más recientes
    fl_file = find_latest_file("leads_florida_wc_all_*.json")
    ga_file = find_latest_file("leads_atlanta_premium_*.json") or find_latest_file("leads_georgia_raw.json")
    il_file = find_latest_file("leads_chicago_raw.json")
    
    print(f"Archivos encontrados:")
    print(f"  Florida: {os.path.basename(fl_file) if fl_file else 'No encontrado'}")
    print(f"  Georgia: {os.path.basename(ga_file) if ga_file else 'No encontrado'}")
    print(f"  Illinois: {os.path.basename(il_file) if il_file else 'No encontrado'}")
    
    # Cargar y normalizar leads
    fl_leads = normalize_florida_leads(load_json_file(fl_file))
    ga_leads = normalize_georgia_leads(load_json_file(ga_file))
    il_leads = normalize_chicago_leads(load_json_file(il_file))
    
    print(f"\nLeads que cumplen la Regla de Oro:")
    print(f"  Florida (>= ${GOLDEN_RULE_THRESHOLDS['FL']:,}): {len(fl_leads)}")
    print(f"  Georgia (>= ${GOLDEN_RULE_THRESHOLDS['GA']:,}): {len(ga_leads)}")
    print(f"  Illinois (>= ${GOLDEN_RULE_THRESHOLDS['IL']:,}): {len(il_leads)}")
    
    # Consolidar y deduplicar
    all_leads = fl_leads + ga_leads + il_leads
    unique_leads = dedup_leads(all_leads)
    
    # Calcular estadísticas
    stats = calculate_stats(unique_leads)
    
    # Crear objeto consolidado
    consolidated = {
        "generated_at": datetime.now().isoformat(),
        "stats": stats,
        "leads": unique_leads
    }
    
    # Guardar archivo consolidado
    with open(CONSOLIDATED_FILE, "w", encoding="utf-8") as f:
        json.dump(consolidated, f, indent=2)
    
    print(f"\nEstadísticas por estado:")
    for state, state_stats in stats.items():
        print(f"  {state}: {state_stats['count']} leads, TPV: ${state_stats['tpv']:,.2f}, Net Profit: ${state_stats['net_profit']:,.2f}, Premium: {state_stats['premium']}")
    
    print(f"\nTotal: {len(unique_leads)} leads consolidados")
    print(f"Archivo guardado en: {CONSOLIDATED_FILE}")
    print("=" * 80)

if __name__ == "__main__":
    main()