#!/usr/bin/env python3
"""
scripts/inject_to_supabase.py

Inyección masiva de leads reales a Supabase (tabla `leads`).
- Escanea leads_florida_wc_all, leads_atlanta_premium, leads_chicago_raw
- Filtra todo dato demo/sintético (SC-BLD-26-*, source "Demo", owners falsos)
- Normaliza al schema del SaaS
- Tier: >$15k diamond - >$10k premium - resto standard
- Upsert por permit_number (dedup automático)

Uso:
  python scripts/inject_to_supabase.py
  python scripts/inject_to_supabase.py --dry-run   (sin escritura, solo preview)
"""

import json
import os
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# -- Cargar credenciales desde saas/.env.local ---------------------------------
def _load_env_file(path: Path):
    if not path.exists():
        return
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, _, v = line.partition('=')
        os.environ.setdefault(k.strip(), v.strip())

_ROOT = Path(__file__).parent.parent
_load_env_file(_ROOT / 'saas' / '.env.local')
_load_env_file(_ROOT / '.env')

try:
    from dotenv import load_dotenv          # carga adicional si está disponible
    load_dotenv(_ROOT / 'saas' / '.env.local', override=False)
    load_dotenv(_ROOT / '.env', override=False)
except ImportError:
    pass

SUPABASE_URL     = os.getenv('NEXT_PUBLIC_SUPABASE_URL', '').rstrip('/')
SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
OUTPUT_DIR       = _ROOT / 'output'
CHUNK_SIZE       = 50

# -- Listas de filtro ----------------------------------------------------------

# Permit prefixes que indican datos sintéticos/demo
DEMO_PERMIT_PREFIXES = ('SC-BLD-26-',)

# Sources que indican datos demo
DEMO_SOURCE_KEYWORDS = ('demo', 'Demo', 'sintético', 'test')

# Nombres propietarios que son placeholders y deben quedar null
FAKE_OWNERS = frozenset({
    '', 'n/a', 'none', 'unknown', 'pending verification',
    'owner 0', 'owner 1', 'owner 2', 'owner 3', 'owner 4',
    'owner 5', 'owner 6', 'owner 7', 'owner 8', 'owner 9',
    'owner 10', 'owner 11', 'owner 12', 'owner 13', 'owner 14',
    'gwinnett client', 'fulton client', 'atlanta client',
    'chicago client 0', 'chicago client 1', 'chicago client 2',
    'chicago client 3', 'chicago client 4', 'chicago client 5',
})

# -- Mapeos --------------------------------------------------------------------

FL_CATEGORY_MAP = {
    'roofing':      'Roofing',
    'cgc':          'CGC',
    'homeBuilders': 'New Construction',
    'other':        'Remodel',
}

IL_TYPE_MAP = {
    'PORCH_CONSTRUCTION':   'Remodel',
    'BASEMENT_FINISHING':   'Remodel',
    'COMMERCIAL_BUILD-OUT': 'CGC',
    'COMMERCIAL_BUILDOUT':  'CGC',
    'ROOFING':              'Roofing',
    'HVAC':                 'HVAC',
}

# -- Helpers -------------------------------------------------------------------

def assign_tier(tpv: float) -> str:
    """Tier según instrucciones: >$15k=diamond - >$10k=premium - resto=standard."""
    if tpv > 15_000: return 'diamond'
    if tpv > 10_000: return 'premium'
    return 'standard'


def clean_owner(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    cleaned = name.strip()
    return None if cleaned.lower() in FAKE_OWNERS else cleaned


def normalize_date(date_str: Optional[str]) -> Optional[str]:
    """Acepta YYYY-MM-DD, MM/DD/YYYY, o ISO con T. Devuelve YYYY-MM-DD o None."""
    if not date_str:
        return None
    s = str(date_str).strip()
    if 'T' in s:
        return s[:10]
    if '/' in s:
        parts = s.split('/')
        if len(parts) == 3:
            m, d, y = parts
            return f'{y.strip()}-{m.strip().zfill(2)}-{d.strip().zfill(2)}'
    return s[:10] if len(s) >= 10 else None


def ga_project_type(permit_type: str) -> str:
    t = (permit_type or '').upper()
    if any(k in t for k in ('RE-ROOF', 'REROOF', 'ROOF REPLACEMENT', 'ROOFING')):
        return 'Roofing'
    if any(k in t for k in ('NEW CONSTRUCTION', 'NEW HOME', 'SINGLE FAMILY', 'NEW SINGLE')):
        return 'New Construction'
    if any(k in t for k in ('COMMERCIAL', 'CGC', 'BUILD-OUT', 'BUILDOUT')):
        return 'CGC'
    if any(k in t for k in ('HVAC', 'MECHANICAL')):
        return 'HVAC'
    return 'Remodel'


def ga_score(lead: dict, tpv: float) -> int:
    s = 10
    pt = (lead.get('permitType') or '').upper()
    if 'ROOF' in pt:                             s += 20
    elif 'COMMERCIAL' in pt or 'CGC' in pt:      s += 15
    elif 'NEW CONSTRUCTION' in pt:               s += 10
    no_gc = not bool(
        (lead.get('contractorName') or '').strip() or
        (lead.get('contractorId')   or '').strip()
    )
    if no_gc:            s += 40
    if tpv > 250_000:    s += 15
    elif tpv > 50_000:   s += 10
    elif tpv > 15_000:   s += 5
    return min(s, 100)


def il_score(lead: dict, valuation: float) -> int:
    s = 10
    ft = (lead.get('Fast_Cash_Type') or '').upper()
    if 'COMMERCIAL' in ft: s += 15
    if 'ROOFING' in ft:    s += 20
    if valuation > 50_000: s += 15
    elif valuation > 15_000: s += 10
    return min(s, 100)


# -- Mappers por estado --------------------------------------------------------

def map_fl(lead: dict) -> Optional[dict]:
    pn = (lead.get('permitNumber') or '').strip()
    if not pn:
        return None

    # Filtrar demo
    source = lead.get('source', '')
    if any(kw in source for kw in DEMO_SOURCE_KEYWORDS):
        return None
    if any(pn.startswith(pfx) for pfx in DEMO_PERMIT_PREFIXES):
        return None

    pv    = lead.get('projectValue') or {}
    roof  = lead.get('roofAnalysis') or {}
    flags = lead.get('flags') or {}

    # TPV real: incluye piso $250k para ciudades PREMIUM
    tpv = float(pv.get('totalProjectValue') or lead.get('valuation') or 0)

    tags = lead.get('tags') or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(',') if t.strip()]
    tags = list(tags)
    if 'FL' not in tags:
        tags.insert(0, 'FL')

    return {
        'city':                (lead.get('city') or '').strip(),
        'zip_code':            lead.get('zip') or None,
        'state':               'FL',
        'county':              lead.get('county') or None,
        'project_type':        FL_CATEGORY_MAP.get(lead.get('category', ''), 'Remodel'),
        'estimated_valuation': tpv,
        'tier':                assign_tier(tpv),
        'score':               int(lead.get('score') or 0),
        'tags':                tags,
        'no_gc':               bool(flags.get('noGC', False)),
        'roof_age':            roof.get('age') or None,
        'roof_classification': roof.get('classification') or None,
        'permit_status':       lead.get('status') or None,
        'market_note':         pv.get('marketNote') or None,
        'exact_address':       lead.get('addressFormatted') or lead.get('address') or None,
        'owner_name':          clean_owner(lead.get('ownerName')),
        'phone':               None,
        'contractor_name':     clean_owner(lead.get('contractorName')),
        'permit_number':       pn,
        'permit_date':         normalize_date(lead.get('permitDate')),
        'government_source':   source or None,
        'processed_at':        lead.get('processedAt') or datetime.now().isoformat(),
    }


def map_ga(lead: dict) -> Optional[dict]:
    # leadId sirve como permit_number único para GA
    pn = (lead.get('leadId') or '').strip()
    if not pn:
        return None

    tpv = float(lead.get('tpv') or lead.get('valuation') or 0)
    if tpv <= 0:
        return None

    tags = lead.get('tags') or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(',') if t.strip()]
    tags = list(tags)
    if 'GA' not in tags:
        tags.insert(0, 'GA')

    no_gc = not bool(
        (lead.get('contractorName') or '').strip() or
        (lead.get('contractorId')   or '').strip()
    )

    return {
        'city':                (lead.get('city') or '').strip(),
        'zip_code':            None,
        'state':               'GA',
        'county':              lead.get('county') or None,
        'project_type':        ga_project_type(lead.get('permitType') or ''),
        'estimated_valuation': tpv,
        'tier':                assign_tier(tpv),
        'score':               ga_score(lead, tpv),
        'tags':                tags,
        'no_gc':               no_gc,
        'roof_age':            None,
        'roof_classification': None,
        'permit_status':       lead.get('status') or None,
        'market_note':         None,
        'exact_address':       lead.get('address') or None,
        'owner_name':          clean_owner(lead.get('ownerName')),
        'phone':               None,
        'contractor_name':     clean_owner(lead.get('contractorName')),
        'permit_number':       pn,
        'permit_date':         normalize_date(lead.get('permitDate')),
        'government_source':   lead.get('source') or 'Accela ACA / Tyler EnerGov (GA)',
        'processed_at':        lead.get('processedAt') or datetime.now().isoformat(),
    }


def map_il(lead: dict) -> Optional[dict]:
    pn = (lead.get('Permit_Number') or '').strip()
    if not pn:
        return None

    valuation = float(lead.get('Valuation') or 0)
    tags = ['IL']
    if lead.get('Is_Chicago'):
        tags.append('CHICAGO')

    return {
        'city':                (lead.get('City') or '').strip(),
        'zip_code':            lead.get('ZIP') or None,
        'state':               'IL',
        'county':              lead.get('County') or None,
        'project_type':        IL_TYPE_MAP.get(lead.get('Fast_Cash_Type') or '', 'Remodel'),
        'estimated_valuation': valuation,
        'tier':                assign_tier(valuation),
        'score':               il_score(lead, valuation),
        'tags':                tags,
        'no_gc':               False,
        'roof_age':            None,
        'roof_classification': None,
        'permit_status':       lead.get('Status') or None,
        'market_note':         None,
        'exact_address':       lead.get('Address') or None,
        'owner_name':          None,   # todos son placeholders falsos
        'phone':               None,
        'contractor_name':     None,
        'permit_number':       pn,
        'permit_date':         normalize_date(lead.get('Fecha_Permiso')),
        'government_source':   'Chicago Data Portal (Cook County)',
        'processed_at':        datetime.now().isoformat(),
    }


# -- Columnas reales de la tabla (detectadas via OpenAPI) ----------------------
# city, estimated_valuation, exact_address, is_locked, owner_name,
# permit_number, phone, project_type, state, tier, zip_code

TABLE_COLUMNS = {
    'city', 'estimated_valuation', 'exact_address', 'is_locked',
    'owner_name', 'permit_number', 'phone', 'project_type',
    'state', 'tier', 'zip_code',
}

def _to_table_schema(lead: dict) -> dict:
    """Filtra solo las columnas que existen en la tabla real. Añade is_locked=True."""
    row = {k: v for k, v in lead.items() if k in TABLE_COLUMNS}
    row['is_locked'] = True   # protegido por defecto hasta que el usuario pague
    return row


# -- Supabase upsert -----------------------------------------------------------

def supabase_upsert(records: List[dict], dry_run: bool = False) -> dict:
    # Adaptar al schema real antes de enviar
    records = [_to_table_schema(r) for r in records]
    url = f'{SUPABASE_URL}/rest/v1/leads?on_conflict=permit_number'
    headers = {
        'apikey':        SERVICE_ROLE_KEY,
        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=minimal',
    }

    result = {'processed': 0, 'errors': []}
    total_chunks = (len(records) + CHUNK_SIZE - 1) // CHUNK_SIZE

    for i in range(0, len(records), CHUNK_SIZE):
        chunk      = records[i:i + CHUNK_SIZE]
        chunk_num  = i // CHUNK_SIZE + 1

        if dry_run:
            print(f'  [DRY RUN] Chunk {chunk_num}/{total_chunks} -- {len(chunk)} registros (no enviado)')
            result['processed'] += len(chunk)
            continue

        payload = json.dumps(chunk, ensure_ascii=False, default=str).encode('utf-8')
        req = urllib.request.Request(url, data=payload, method='POST')
        for k, v in headers.items():
            req.add_header(k, v)

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                # return=minimal → 204 No Content, sin body
                result['processed'] += len(chunk)
                print(f'  Chunk {chunk_num}/{total_chunks}: OK {len(chunk)} leads → Supabase OK (HTTP {resp.status})')
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='replace')
            msg = f'Chunk {chunk_num} HTTP {e.code}: {err_body[:400]}'
            print(f'  ERROR: {msg}')
            result['errors'].append(msg)
        except Exception as exc:
            msg = f'Chunk {chunk_num} Network error: {exc}'
            print(f'  ERROR: {msg}')
            result['errors'].append(msg)

    return result


# -- Main ----------------------------------------------------------------------

def main():
    dry_run = '--dry-run' in sys.argv

    print('=' * 70)
    print('  MULTIVENZA -- INYECCIÓN MASIVA A SUPABASE')
    print('=' * 70)
    print(f'  Supabase : {SUPABASE_URL}')
    key_preview = SERVICE_ROLE_KEY[:30] + '...' if len(SERVICE_ROLE_KEY) > 30 else 'AVISO: NO CONFIGURADA'
    print(f'  Rol Key  : {key_preview}')
    print(f'  Modo     : {"DRY RUN -- sin escritura" if dry_run else "LIVE -- escribiendo a Supabase"}')
    print('-' * 70)

    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        print('\nERROR: Faltan credenciales. Verifica saas/.env.local:')
        print('   NEXT_PUBLIC_SUPABASE_URL=...')
        print('   SUPABASE_SERVICE_ROLE_KEY=...')
        sys.exit(1)

    all_leads: List[dict] = []
    report = {}

    # -- Florida ---------------------------------------------------------------
    print('\n[1/3] [FL] Florida -- leads_florida_wc_all_2026-04-16.json')
    fl_file = OUTPUT_DIR / 'leads_florida_wc_all_2026-04-16.json'
    fl_ok = fl_demo = 0
    if fl_file.exists():
        raw_fl = json.loads(fl_file.read_text(encoding='utf-8'))
        for lead in raw_fl:
            mapped = map_fl(lead)
            if mapped:
                all_leads.append(mapped)
                fl_ok += 1
            else:
                fl_demo += 1
        print(f'     OK {fl_ok} leads reales  |  X {fl_demo} demo filtrados (Sarasota sintéticos)')
    else:
        print('     AVISO: Archivo no encontrado')
    report['FL'] = fl_ok

    # -- Georgia ---------------------------------------------------------------
    print('\n[2/3] [GA] Georgia -- leads_atlanta_premium_2026-04-18.json')
    ga_file = OUTPUT_DIR / 'leads_atlanta_premium_2026-04-18.json'
    ga_ok = 0
    if ga_file.exists():
        raw_ga = json.loads(ga_file.read_text(encoding='utf-8'))
        for lead in raw_ga:
            mapped = map_ga(lead)
            if mapped:
                all_leads.append(mapped)
                ga_ok += 1
        print(f'     OK {ga_ok} leads  (Fulton + Gwinnett, Filtro de Hierro >$15k aplicado en origen)')
    else:
        print('     AVISO: Archivo no encontrado')
    report['GA'] = ga_ok

    # -- Illinois --------------------------------------------------------------
    print('\n[3/3] [IL] Illinois -- leads_chicago_raw.json')
    il_file = OUTPUT_DIR / 'leads_chicago_raw.json'
    il_ok = 0
    if il_file.exists():
        raw_il = json.loads(il_file.read_text(encoding='utf-8'))
        for lead in raw_il:
            mapped = map_il(lead)
            if mapped:
                all_leads.append(mapped)
                il_ok += 1
        print(f'     OK {il_ok} leads  (owners falsos nullificados)')
    else:
        print('     AVISO: Archivo no encontrado')
    report['IL'] = il_ok

    # -- Deduplicación ---------------------------------------------------------
    seen: set = set()
    unique: List[dict] = []
    for lead in all_leads:
        pn = lead['permit_number']
        if pn not in seen:
            seen.add(pn)
            unique.append(lead)

    dupes = len(all_leads) - len(unique)

    # -- Breakdown -------------------------------------------------------------
    by_tier  = {'diamond': 0, 'premium': 0, 'standard': 0}
    by_state = {'FL': 0, 'GA': 0, 'IL': 0}
    for l in unique:
        by_tier[l.get('tier', 'standard')]  = by_tier.get(l.get('tier', 'standard'), 0) + 1
        by_state[l.get('state', '?')]        = by_state.get(l.get('state', '?'), 0) + 1

    print(f'\n{"-" * 70}')
    print(f'  Total acumulado       : {len(all_leads)}')
    print(f'  Duplicados removidos  : {dupes}')
    print(f'  OK Leads únicos       : {len(unique)}')
    print(f'\n  Tier breakdown:')
    print(f'    [D] Diamond (>$15k)  : {by_tier["diamond"]}')
    print(f'    [P] Premium  (>$10k)  : {by_tier["premium"]}')
    print(f'    [ ] Standard          : {by_tier["standard"]}')
    print(f'\n  Por estado:')
    for st, n in by_state.items():
        print(f'    {st}               : {n}')
    print(f'{"-" * 70}')

    if not unique:
        print('\nAVISO: Sin leads para inyectar. Verifica los archivos de output.')
        return

    # -- Inyección -------------------------------------------------------------
    print(f'\nInyectando {len(unique)} leads a Supabase (upsert por permit_number)...\n')
    result = supabase_upsert(unique, dry_run=dry_run)

    print(f'\n{"=" * 70}')
    if result['errors']:
        print(f'  AVISO: Completado con {len(result["errors"])} error(es):')
        for e in result['errors']:
            print(f'     - {e}')
    else:
        mode = 'simulados' if dry_run else 'escritos en Supabase'
        print(f'  OK {result["processed"]} registros {mode} exitosamente')
        if not dry_run:
            print(f'     Verifica en: https://supabase.com/dashboard/project/oigvairgxdldrsrjqaht/editor')
    print(f'{"=" * 70}\n')


if __name__ == '__main__':
    main()
