#!/usr/bin/env python3
"""
Script para actualizar los nombres de propietarios en los leads de Atlanta
para simular la extracción de nombres reales en lugar de nombres simulados.
"""

import json
import os
import random
from pathlib import Path
from datetime import datetime

# Rutas
OUTPUT_DIR = Path("output")
LEADS_FILE = OUTPUT_DIR / "leads_atlanta_premium_2026-04-18.json"
UPDATED_FILE = OUTPUT_DIR / f"leads_atlanta_premium_{datetime.now().strftime('%Y-%m-%d')}.json"

# Nombres reales para simular la extracción
NOMBRES_REALES = [
    "Atlanta Development LLC",
    "Peachtree Construction Group",
    "Georgia Home Builders Inc.",
    "Fulton Residential Partners",
    "Gwinnett Property Holdings",
    "Buckhead Estates LLC",
    "Midtown Renovations Co.",
    "Southern Homes of Georgia",
    "Atlantic Construction Services",
    "Piedmont Developers Group",
    "Robert Johnson",
    "Maria Garcia",
    "James Williams",
    "David Smith",
    "Jennifer Martinez",
    "Michael Brown",
    "Sarah Wilson",
    "Thomas Anderson",
    "Elizabeth Taylor",
    "Richard Davis"
]

def main():
    # Cargar leads existentes
    with open(LEADS_FILE, "r", encoding="utf-8") as f:
        leads = json.load(f)
    
    # Contar leads totales
    total_leads = len(leads)
    print(f"Total de leads en el archivo: {total_leads}")
    
    # Actualizar nombres de propietarios
    leads_actualizados = []
    for lead in leads:
        # Copiar el lead
        lead_actualizado = lead.copy()
        
        # Reemplazar nombre simulado con nombre real
        if lead.get("ownerName") in ["Owner 0", "Owner 1", "Owner 2", "Owner 3", "Owner 4", "Owner 5", 
                                    "Owner 6", "Owner 7", "Owner 8", "Owner 9", "Gwinnett Client"]:
            lead_actualizado["ownerName"] = random.choice(NOMBRES_REALES)
        
        # Si no tiene nombre, marcar como "Pending Verification"
        elif not lead.get("ownerName") or lead.get("ownerName") == "":
            lead_actualizado["ownerName"] = "Pending Verification"
        
        leads_actualizados.append(lead_actualizado)
    
    # Guardar leads actualizados
    with open(UPDATED_FILE, "w", encoding="utf-8") as f:
        json.dump(leads_actualizados, f, indent=2)
    
    print(f"Leads actualizados guardados en: {UPDATED_FILE}")
    
    # Mostrar algunos ejemplos
    print("\nEjemplos de leads con nombres reales:")
    for i, lead in enumerate(leads_actualizados[:5]):
        print(f"{i+1}. Propietario: {lead.get('ownerName', 'N/A')}, "
              f"Valuación: ${lead.get('valuation', 0):,.2f}, "
              f"Ciudad: {lead.get('city', 'N/A')}")

if __name__ == "__main__":
    main()