"""
processor_final.py

Cruza BASE_DATOS_LEADS_REALES_MULTIVENZA.csv con FAST_CASH_PRIORITY.csv:
  1. Carga ambos archivos
  2. Elimina duplicados por Permit #
  3. Copia nombres de propietario de FAST_CASH_PRIORITY → BASE_DATOS cuando falten
  4. Reporta diferencias y genera BASE_DATOS_LEADS_ENRIQUECIDA.csv

Uso:
  python processor_final.py
"""

import csv
import os
from pathlib import Path

OUTPUT_DIR   = Path("output")
BASE_FILE    = OUTPUT_DIR / "BASE_DATOS_LEADS_REALES_MULTIVENZA.csv"
FAST_FILE    = OUTPUT_DIR / "FAST_CASH_PRIORITY.csv"
OUTPUT_FILE  = OUTPUT_DIR / "BASE_DATOS_LEADS_ENRIQUECIDA.csv"

LINE = "─" * 72


def load_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def main():
    print(f"\n{'='*72}")
    print("  PROCESSOR FINAL — MULTIVENZA LEADHUNTER")
    print(f"{'='*72}\n")

    # ── 1. Verificar archivos ──────────────────────────────────────────────
    for p in (BASE_FILE, FAST_FILE):
        if not p.exists():
            print(f"  ERROR: No se encontró {p}")
            print("  Asegúrate de correr desde la raíz del proyecto.")
            return

    # ── 2. Cargar datos ────────────────────────────────────────────────────
    base_rows  = load_csv(BASE_FILE)
    fast_rows  = load_csv(FAST_FILE)

    print(f"  BASE_DATOS original  : {len(base_rows)} registros")
    print(f"  FAST_CASH_PRIORITY   : {len(fast_rows)} registros\n")

    # ── 3. Construir índice FAST_CASH por Permit # ────────────────────────
    # Columnas FAST_CASH: Permit_Number, Owner_Name, Co_Owner, Address, ...
    fast_index: dict[str, dict] = {}
    for row in fast_rows:
        permit = row.get("Permit_Number", "").strip()
        if permit:
            fast_index[permit] = row

    # ── 4. Dedup BASE_DATOS por "Permit #" ────────────────────────────────
    seen_permits: set[str] = set()
    deduped: list[dict] = []
    dupes = 0

    for row in base_rows:
        permit = row.get("Permit #", "").strip()
        if permit in seen_permits:
            dupes += 1
            continue
        seen_permits.add(permit)
        deduped.append(row)

    print(f"  Duplicados eliminados : {dupes}")
    print(f"  Registros únicos      : {len(deduped)}\n")

    # ── 5. Cruzar nombres desde FAST_CASH ─────────────────────────────────
    enriched    = 0
    not_found   = 0
    already_had = 0
    cross_stats: list[dict] = []

    for row in deduped:
        permit     = row.get("Permit #", "").strip()
        owner_base = row.get("Propietario (PA)", "").strip()
        fast       = fast_index.get(permit)

        status = "—"

        if fast:
            owner_fast = fast.get("Owner_Name", "").strip()
            co_fast    = fast.get("Co_Owner",   "").strip()

            if owner_fast and not owner_base:
                row["Propietario (PA)"]   = owner_fast
                row["Co-Propietario (PA)"] = co_fast
                row["Estado Verificación PA"] = fast.get("PA_Status", "VERIFICADO_FAST_CASH")
                enriched += 1
                status = f"ENRIQUECIDO ← {owner_fast}"
            elif owner_fast and owner_base:
                already_had += 1
                status = f"YA TENÍA: {owner_base}"
            else:
                not_found += 1
                status = "SIN NOMBRE EN FAST_CASH"
        else:
            not_found += 1
            status = "PERMIT NO ENCONTRADO EN FAST_CASH"

        cross_stats.append({"permit": permit, "address": row.get("Dirección", ""), "status": status})

    # ── 6. Escribir CSV enriquecido ────────────────────────────────────────
    if deduped:
        fieldnames = list(deduped[0].keys())
        with open(OUTPUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(deduped)

    # ── 7. Resumen ─────────────────────────────────────────────────────────
    print(LINE)
    print("  RESULTADO DEL CRUCE\n")
    print(f"  {'Permit #':<20} {'Dirección':<35} Estado")
    print(f"  {LINE}")
    for s in cross_stats:
        permit  = s["permit"][:18].ljust(20)
        address = s["address"][:33].ljust(35)
        print(f"  {permit} {address} {s['status']}")

    print(f"\n  {LINE}")
    print(f"  Registros únicos procesados : {len(deduped)}")
    print(f"  Nombres enriquecidos        : {enriched}  (FAST_CASH → BASE_DATOS)")
    print(f"  Ya tenían nombre            : {already_had}")
    print(f"  Sin match en FAST_CASH      : {not_found}")
    print(f"\n  Archivo generado: {OUTPUT_FILE}")
    print(f"  {LINE}\n")


if __name__ == "__main__":
    main()
