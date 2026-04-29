#!/usr/bin/env python3
"""
Script para limpiar el dashboard de datos de prueba y asegurarse de que
solo se muestren leads con nombres reales.
"""

import json
import os
from pathlib import Path
from datetime import datetime

# Rutas
OUTPUT_DIR = Path("output")
CONSOLIDATED_FILE = Path("consolidated_leads.json")
CLEANED_FILE = Path("consolidated_leads_clean.json")

# Nombres de prueba a eliminar
NOMBRES_PRUEBA = [
    "Owner 0", "Owner 1", "Owner 2", "Owner 3", "Owner 4", 
    "Owner 5", "Owner 6", "Owner 7", "Owner 8", "Owner 9",
    "Chicago Client", "Gwinnett Client", "Test Owner", "Sample Owner",
    "", None
]

def main():
    # Cargar leads consolidados
    with open(CONSOLIDATED_FILE, "r", encoding="utf-8") as f:
        consolidated = json.load(f)
    
    # Contar leads totales antes de la limpieza
    total_antes = len(consolidated["leads"])
    print(f"Total de leads antes de la limpieza: {total_antes}")
    
    # Filtrar leads con nombres de prueba
    leads_limpios = [lead for lead in consolidated["leads"] 
                    if lead.get("ownerName") not in NOMBRES_PRUEBA]
    
    # Contar leads eliminados
    leads_eliminados = total_antes - len(leads_limpios)
    print(f"Leads eliminados: {leads_eliminados}")
    print(f"Leads restantes: {len(leads_limpios)}")
    
    # Actualizar estadísticas
    stats = {
        "FL": {"count": 0, "tpv": 0, "net_profit": 0},
        "GA": {"count": 0, "tpv": 0, "net_profit": 0},
        "IL": {"count": 0, "tpv": 0, "net_profit": 0}
    }
    
    for lead in leads_limpios:
        state = lead.get("state")
        if state in stats:
            stats[state]["count"] += 1
            stats[state]["tpv"] += float(lead.get("tpv", 0))
            stats[state]["net_profit"] += float(lead.get("net_profit_35", 0))
    
    # Crear nuevo objeto consolidado
    consolidated_limpio = {
        "stats": stats,
        "leads": leads_limpios
    }
    
    # Guardar archivo limpio
    with open(CLEANED_FILE, "w", encoding="utf-8") as f:
        json.dump(consolidated_limpio, f, indent=2)
    
    # Reemplazar el archivo original
    with open(CONSOLIDATED_FILE, "w", encoding="utf-8") as f:
        json.dump(consolidated_limpio, f, indent=2)
    
    # Copiar a la carpeta output
    with open(OUTPUT_DIR / "consolidated_leads.json", "w", encoding="utf-8") as f:
        json.dump(consolidated_limpio, f, indent=2)
    
    print(f"Dashboard limpiado exitosamente.")
    print(f"Archivo limpio guardado en: {CLEANED_FILE}")
    print(f"Archivo original reemplazado: {CONSOLIDATED_FILE}")
    print(f"Copia guardada en: {OUTPUT_DIR / 'consolidated_leads.json'}")
    
    # Mostrar estadísticas actualizadas
    print("\nEstadísticas actualizadas:")
    for state, data in stats.items():
        print(f"  {state}: {data['count']} leads, TPV: ${data['tpv']:,.2f}, Net Profit: ${data['net_profit']:,.2f}")

if __name__ == "__main__":
    main()