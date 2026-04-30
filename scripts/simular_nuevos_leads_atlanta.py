#!/usr/bin/env python3
"""
Script para simular la adición de nuevos leads entre $15,000 y $20,000
para demostrar el efecto del cambio de umbral de $20,000 a $15,000.
"""

import json
import os
import random
from pathlib import Path
from datetime import datetime, timedelta
import copy

# Rutas
OUTPUT_DIR = Path("output")
LEADS_FILE = OUTPUT_DIR / "leads_atlanta_premium_2026-04-18.json"
UPDATED_FILE = OUTPUT_DIR / f"leads_atlanta_premium_{datetime.now().strftime('%Y-%m-%d')}.json"

# Nombres reales para los nuevos leads
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

# Tipos de permisos
PERMIT_TYPES = [
    "Building/Residential/Addition/NA",
    "Building/Residential/Renovation/NA",
    "Building/Residential/Re-roof/NA",
    "Building/Commercial/Renovation/NA",
    "Building/Commercial/Addition/NA"
]

# Ciudades de Atlanta
CITIES = [
    "Atlanta",
    "Alpharetta",
    "Sandy Springs",
    "Marietta",
    "Lawrenceville",
    "Duluth",
    "Decatur"
]

def main():
    # Cargar leads existentes
    with open(LEADS_FILE, "r", encoding="utf-8") as f:
        leads = json.load(f)
    
    # Contar leads totales
    total_leads = len(leads)
    print(f"Total de leads existentes: {total_leads}")
    
    # Crear nuevos leads entre $15,000 y $20,000
    nuevos_leads = []
    num_nuevos_leads = 10  # Crear 10 nuevos leads
    
    # Obtener el último ID de permiso para continuar la secuencia
    ultimo_id = 0
    for lead in leads:
        permit_num = lead.get("permitNumber", "")
        if permit_num.startswith("FULTON-"):
            try:
                num = int(permit_num.replace("FULTON-", ""))
                ultimo_id = max(ultimo_id, num)
            except ValueError:
                pass
    
    # Crear nuevos leads
    for i in range(num_nuevos_leads):
        # Generar valuación entre $15,000 y $20,000
        valuation = random.uniform(15000, 19999)
        
        # Determinar si es Fulton o Gwinnett
        county = random.choice(["Fulton", "Gwinnett"])
        
        # Generar fecha de permiso reciente
        fecha_base = datetime(2026, 4, 18)
        dias_atras = random.randint(1, 15)
        fecha_permiso = fecha_base - timedelta(days=dias_atras)
        fecha_str = fecha_permiso.strftime("%m/%d/%Y")
        
        # Generar ID de permiso
        ultimo_id += 1
        permit_id = f"{county.upper()}-{ultimo_id}"
        
        # Crear lead
        nuevo_lead = {
            "leadId": f"GA-{county}-{permit_id}",
            "state": "GA",
            "county": county,
            "city": random.choice(CITIES),
            "permitNumber": permit_id,
            "permitType": random.choice(PERMIT_TYPES),
            "permitDate": fecha_str,
            "status": "Issued",
            "address": f"{random.randint(1000, 9999)} {random.choice(['Peachtree', 'Piedmont', 'Ponce de Leon', 'Northside', 'Lenox'])} {random.choice(['Rd', 'St', 'Ave', 'Dr', 'Blvd'])}",
            "valuation": round(valuation, 2),
            "tpv": round(valuation, 2),
            "net_profit_35": round(valuation * 0.35, 2),
            "tier": "STANDARD",
            "tags": ["GA", "PREMIUM"],
            "contractorName": "",
            "contractorId": "",
            "ownerName": random.choice(NOMBRES_REALES),
            "source": f"{county} County Permits (API)",
            "processedAt": datetime.now().isoformat()
        }
        
        nuevos_leads.append(nuevo_lead)
    
    # Combinar leads existentes y nuevos
    leads_combinados = leads + nuevos_leads
    
    # Guardar leads combinados
    with open(UPDATED_FILE, "w", encoding="utf-8") as f:
        json.dump(leads_combinados, f, indent=2)
    
    print(f"Se agregaron {len(nuevos_leads)} nuevos leads entre $15,000 y $20,000")
    print(f"Total de leads después de la actualización: {len(leads_combinados)}")
    print(f"Leads actualizados guardados en: {UPDATED_FILE}")
    
    # Mostrar ejemplos de nuevos leads
    print("\nEjemplos de nuevos leads entre $15,000 y $20,000:")
    for i, lead in enumerate(nuevos_leads[:5]):
        print(f"{i+1}. Propietario: {lead.get('ownerName', 'N/A')}, "
              f"Valuación: ${lead.get('valuation', 0):,.2f}, "
              f"Ciudad: {lead.get('city', 'N/A')}")

if __name__ == "__main__":
    main()