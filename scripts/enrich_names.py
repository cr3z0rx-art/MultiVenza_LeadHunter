import csv
import json
import os
import glob
from pathlib import Path

# Paths
BASE_DIR = Path(r"c:\Users\yildr\Desktop\MultiVenza_LeadHunter")
OUTPUT_DIR = BASE_DIR / "output"
DASHBOARD_HTML = OUTPUT_DIR / "DASHBOARD_FAST_CASH.html"
SKIP_TRACING_CSV = OUTPUT_DIR / "LEADS_DIAMANTE_CON_TELEFONO_2026-04-16.csv"

# Global Mapping
name_map = {}

def load_quality_names():
    """Load high-quality names from skip tracing and other enriched files."""
    if SKIP_TRACING_CSV.exists():
        with open(SKIP_TRACING_CSV, newline='', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                permit = row.get("Permiso #")
                # Priority: Google Maps Name > Propietario (if not Owner X)
                best_name = row.get("Nombre en Google Maps") or ""
                real_owner = row.get("Propietario") or ""
                
                final_name = ""
                if best_name and "LLC" in best_name.upper() or "INC" in best_name.upper():
                    final_name = best_name
                elif real_owner and not real_owner.startswith("Owner "):
                    final_name = real_owner
                elif best_name:
                    final_name = best_name
                
                if final_name and permit:
                    name_map[permit] = final_name

def enrich_dashboard():
    load_quality_names()
    
    # Re-run the main dashboard logic but with name enrichment
    # (Simplified for this script - in practice I'd modularize the main script)
    # For now, I'll just rewrite the logic into a more robust one.
    
    # ... (Logic to rebuild dashboard with enriched names) ...
    pass

if __name__ == "__main__":
    enrich_dashboard()
