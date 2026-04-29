#!/usr/bin/env python3
"""
Script para verificar los leads de Georgia en el dashboard.
"""

import json
from pathlib import Path
from datetime import datetime

# Rutas
CONSOLIDATED_FILE = Path("consolidated_leads.json")
ATLANTA_PREMIUM_FILE = Path("output") / f"leads_atlanta_premium_{datetime.now().strftime('%Y-%m-%d')}.json"

def main():
    # Verificar si existe el archivo de leads de Atlanta Premium
    if ATLANTA_PREMIUM_FILE.exists():
        print(f"Verificando archivo: {ATLANTA_PREMIUM_FILE}")
        # Cargar leads de Atlanta Premium
        with open(ATLANTA_PREMIUM_FILE, "r", encoding="utf-8") as f:
            ga_leads = json.load(f)
    else:
        print(f"Archivo {ATLANTA_PREMIUM_FILE} no encontrado. Verificando consolidated_leads.json")
        # Cargar leads consolidados
        with open(CONSOLIDATED_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        # Filtrar leads de Georgia
        ga_leads = [lead for lead in data["leads"] if lead.get("state") == "GA"]
    
    # Contar leads
    total_leads = len(ga_leads)
    print(f"Total leads de Georgia: {total_leads}")
    
    # Verificar nombres de propietarios
    leads_con_nombres_reales = [lead for lead in ga_leads if lead.get("ownerName") and 
                               lead.get("ownerName") not in ["Owner 1", "Owner 2", "Gwinnett Client", "", "Pending Verification"]]
    
    leads_pendientes = [lead for lead in ga_leads if lead.get("ownerName") == "Pending Verification"]
    
    print(f"Leads con nombres reales: {len(leads_con_nombres_reales)} ({len(leads_con_nombres_reales)/total_leads*100:.1f}%)")
    print(f"Leads pendientes de verificación: {len(leads_pendientes)} ({len(leads_pendientes)/total_leads*100:.1f}%)")
    
    # Verificar leads entre $15,000 y $20,000
    leads_15k_20k = [lead for lead in ga_leads if 15000 <= float(lead.get("valuation", 0)) < 20000]
    print(f"Leads entre $15,000 y $20,000: {len(leads_15k_20k)}")
    
    # Mostrar ejemplos de leads con nombres reales
    print("\nEjemplos de leads con nombres reales:")
    for i, lead in enumerate(leads_con_nombres_reales[:5]):
        print(f"{i+1}. Propietario: {lead.get('ownerName', 'N/A')}, "
              f"Valuación: ${float(lead.get('valuation', 0)):,.2f}, "
              f"Ciudad: {lead.get('city', 'N/A')}")
    
    # Mostrar ejemplos de leads entre $15,000 y $20,000
    print("\nEjemplos de leads entre $15,000 y $20,000:")
    for i, lead in enumerate(leads_15k_20k[:5]):
        print(f"{i+1}. Propietario: {lead.get('ownerName', 'N/A')}, "
              f"Valuación: ${float(lead.get('valuation', 0)):,.2f}, "
              f"Ciudad: {lead.get('city', 'N/A')}")

if __name__ == "__main__":
    main()