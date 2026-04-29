import json
from datetime import datetime
import re
import os
from pathlib import Path
import sys

# Importar financials.py para usar las constantes y funciones compartidas
sys.path.append(str(Path(__file__).parent))
from financials import (
    calculate_financials,
    passes_golden_rule,
    GOLDEN_RULE_THRESHOLDS,
    NET_PROFIT_RATE
)

def load_json(path):
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def normalize_florida(leads):
    normalized = []
    for l in leads:
        try:
            val = float(l.get('valuation', 0))
            state = "FL"
            city = l.get('city', 'N/A')
            
            # Aplicar Regla de Oro para FL: >= $10k
            if passes_golden_rule(val, state):
                # Usar financials.py para calcular TPV y net_profit
                financials = calculate_financials(valuation=val, state=state, city=city)
                
                normalized.append({
                    "state": state,
                    "type": l.get('category', 'N/A').upper(),
                    "permit": l.get('permitNumber', 'N/A'),
                    "owner": l.get('ownerName', 'Unknown'),
                    "address": l.get('address', 'N/A'),
                    "city": city,
                    "valuation": val,
                    "tpv": financials["tpv"],
                    "net_profit": financials["net_profit_35"],
                    "tier": financials["tier"],
                    "phone": "",
                    "status": l.get('status', 'Issued')
                })
        except Exception as e:
            print(f"Error procesando lead FL: {e}")
            continue
    return normalized

def normalize_georgia(leads):
    normalized = []
    for l in leads:
        try:
            val = float(l.get('valuation', 0))
            state = "GA"
            city = l.get('city', 'N/A')
            
            # Aplicar Filtro de Hierro para GA: > $15k
            if val > GOLDEN_RULE_THRESHOLDS["GA"]:
                # Usar financials.py para calcular TPV y net_profit
                financials = calculate_financials(valuation=val, state=state, city=city)
                
                # Añadir etiqueta "High-Ticket Lead" para GA
                permit_type = l.get('permitType', 'N/A').upper()
                
                # Identificar nichos prioritarios
                is_priority_niche = any(keyword in permit_type for keyword in
                                       ["NEW CONSTRUCTION", "ADDITION", "RE-ROOF", "REROOF"])
                
                normalized.append({
                    "state": state,
                    "type": permit_type,
                    "permit": l.get('permitNumber', 'N/A'),
                    "owner": l.get('ownerName', 'Unknown'),
                    "address": l.get('address', 'N/A'),
                    "city": city,
                    "valuation": val,
                    "tpv": financials["tpv"],
                    "net_profit": financials["net_profit_35"],
                    "tier": "HIGH-TICKET" if is_priority_niche else "STANDARD",
                    "phone": "",
                    "status": l.get('status', 'Issued')
                })
        except Exception as e:
            print(f"Error procesando lead GA: {e}")
            continue
    return normalized

def normalize_chicago(leads):
    normalized = []
    for l in leads:
        try:
            val = float(str(l.get('Valuation', 0)).replace(',', ''))
            state = "IL"
            city = l.get('City', 'N/A')
            
            # Aplicar Regla de Oro para IL: >= $15k
            if passes_golden_rule(val, state):
                # Usar financials.py para calcular TPV y net_profit
                financials = calculate_financials(valuation=val, state=state, city=city)
                
                normalized.append({
                    "state": state,
                    "type": l.get('Fast_Cash_Type', 'N/A').upper(),
                    "permit": l.get('Permit_Number', 'N/A'),
                    "owner": l.get('Owner_Name', 'Unknown'),
                    "address": l.get('Address', 'N/A'),
                    "city": city,
                    "valuation": val,
                    "tpv": financials["tpv"],
                    "net_profit": financials["net_profit_35"],
                    "tier": "STANDARD",
                    "phone": "",
                    "status": l.get('Status', 'Active')
                })
        except Exception as e:
            print(f"Error procesando lead IL: {e}")
            continue
    return normalized

def dedup_leads(leads):
    """Deduplicación por clave compuesta (state + permit_number)"""
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

def main():
    print("Iniciando consolidación de leads...")
    
    # Rutas
    fl_path = 'output/leads_florida_wc_all_2026-04-16.json'
    ga_path = 'output/leads_atlanta_premium_2026-04-18.json'
    il_path = 'output/leads_chicago_raw.json'
    html_path = 'output/DASHBOARD_MULTI_STATE.html'
    
    # Mostrar umbrales por estado
    print(f"Aplicando Regla de Oro por estado:")
    for state, threshold in GOLDEN_RULE_THRESHOLDS.items():
        print(f"  {state}: ${threshold:,}")
    print(f"Net Profit Rate uniforme: {NET_PROFIT_RATE*100:.0f}%")

    # Carga y Normalización
    all_leads = []
    all_leads.extend(normalize_florida(load_json(fl_path)))
    all_leads.extend(normalize_georgia(load_json(ga_path)))
    all_leads.extend(normalize_chicago(load_json(il_path)))
    
    # Deduplicación por state + permit_number
    all_leads = dedup_leads(all_leads)

    # Estadísticas por estado
    states = {}
    for lead in all_leads:
        state = lead["state"]
        if state not in states:
            states[state] = {"count": 0, "tpv": 0, "net_profit": 0}
        states[state]["count"] += 1
        states[state]["tpv"] += lead.get("tpv", lead.get("valuation", 0))
        states[state]["net_profit"] += lead["net_profit"]
    
    print("\nEstadísticas por estado:")
    for state, stats in states.items():
        print(f"  {state}: {stats['count']} leads, TPV: ${stats['tpv']:,.2f}, Net Profit: ${stats['net_profit']:,.2f}")
    
    print(f"\nTotal leads que cumplen la Regla de Oro: {len(all_leads)}")

    # Actualización del HTML
    if os.path.exists(html_path):
        with open(html_path, 'r', encoding='utf-8') as f:
            html_content = f.read()

        # Reemplazar la data usando marcadores HTML en lugar de regex frágil
        new_data_json = json.dumps(all_leads, indent=4)
        
        # Buscar marcadores existentes o crearlos
        if "// BEGIN_LEADS_DATA" not in html_content:
            # Primera ejecución: insertar marcadores si no existen de ninguna forma (aunque suele existir)
            pass
        
        # Usar los marcadores para reemplazar de forma segura
        parts = html_content.split("// BEGIN_LEADS_DATA")
        if len(parts) >= 2:
            pre = parts[0]
            post = parts[1].split("// END_LEADS_DATA")[1]
            updated_html = f"{pre}// BEGIN_LEADS_DATA\n                const leadsData = {new_data_json};\n                // END_LEADS_DATA{post}"
        else:
            # Fallback al método anterior si no se encuentran marcadores
            pattern = r'const leadsData = \[.*?\];'
            replacement = f'const leadsData = {new_data_json};'
            updated_html = re.sub(pattern, replacement, html_content, flags=re.DOTALL)
        
        # Actualizar título si es necesario
        updated_html = updated_html.replace('FLORIDA ENRICHED', 'MULTI-STATE PIPELINE')
        updated_html = updated_html.replace('Florida WC Pipeline', 'USA Multi-State Lead Pipeline')

        # Guardar el HTML actualizado
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(updated_html)
        
        # Generar también un archivo JSON separado para futuras mejoras
        consolidated_path = 'output/consolidated_leads.json'
        consolidated_data = {
            "generated_at": datetime.now().isoformat(),
            "stats": states,
            "leads": all_leads
        }
        
        with open(consolidated_path, 'w', encoding='utf-8') as f:
            json.dump(consolidated_data, f, indent=2)
        
        # Copiar el archivo a la raíz para compatibilidad con el dashboard
        root_consolidated_path = 'consolidated_leads.json'
        with open(root_consolidated_path, 'w', encoding='utf-8') as f:
            json.dump(consolidated_data, f, indent=2)
        
        print(f"Dashboard actualizado exitosamente. JSON consolidado guardado en {consolidated_path} y {root_consolidated_path}")
    else:
        print("Error: No se encontró DASHBOARD_FAST_CASH.html")

if __name__ == "__main__":
    main()
