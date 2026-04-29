#!/usr/bin/env python3
"""
Script para analizar los leads de Atlanta y ver cuántos nuevos leads se capturarían
con el umbral de $15,000 en lugar de $20,000
"""

import json
import os
from pathlib import Path

# Rutas
OUTPUT_DIR = Path("output")
LEADS_FILE = OUTPUT_DIR / "leads_atlanta_premium_2026-04-18.json"

def main():
    # Cargar leads existentes
    with open(LEADS_FILE, "r", encoding="utf-8") as f:
        leads = json.load(f)
    
    # Contar leads totales
    total_leads = len(leads)
    print(f"Total de leads en el archivo: {total_leads}")
    
    # Contar leads entre $15,000 y $20,000
    leads_15k_20k = [lead for lead in leads if 15000 <= float(lead.get("valuation", 0)) < 20000]
    print(f"Leads entre $15,000 y $20,000: {len(leads_15k_20k)}")
    
    # Mostrar algunos ejemplos
    print("\nEjemplos de leads entre $15,000 y $20,000:")
    for i, lead in enumerate(leads_15k_20k[:5]):
        print(f"{i+1}. Valuación: ${lead.get('valuation', 0):,.2f}, "
              f"Propietario: {lead.get('ownerName', 'N/A')}, "
              f"Ciudad: {lead.get('city', 'N/A')}")
    
    # Verificar nombres de propietarios
    leads_con_nombres_reales = [lead for lead in leads if lead.get("ownerName") and 
                               lead.get("ownerName") not in ["Owner 1", "Owner 2", "Gwinnett Client", "", "Pending Verification"]]
    print(f"\nLeads con nombres reales de propietarios: {len(leads_con_nombres_reales)}")
    
    # Mostrar algunos ejemplos de nombres reales
    print("\nEjemplos de leads con nombres reales:")
    for i, lead in enumerate(leads_con_nombres_reales[:5]):
        print(f"{i+1}. Propietario: {lead.get('ownerName', 'N/A')}, "
              f"Valuación: ${lead.get('valuation', 0):,.2f}, "
              f"Ciudad: {lead.get('city', 'N/A')}")

if __name__ == "__main__":
    main()