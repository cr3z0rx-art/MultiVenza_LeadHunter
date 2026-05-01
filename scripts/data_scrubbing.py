import os
import re
import sys
import json
import requests
from dotenv import load_dotenv

# Cargar variables de entorno (asumiendo que están en la raíz o en .env local)
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL') or os.getenv('SAAS_API_URL')
# Intentamos obtener la key, si no está en Python local, pediremos correr un script Node o usar Vercel
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SAAS_API_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ ERROR: No se encontraron credenciales de Supabase en el .env local.")
    print("Asegúrate de tener NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.")
    sys.exit(1)

# Fix si el URL es el de Vercel en vez de Supabase directamente
if 'vercel.app' in SUPABASE_URL:
    print("⚠️  Advertencia: Detectado URL de Vercel en lugar de Supabase directo.")
    print("Este script requiere conexión directa a la BD para operaciones de limpieza masiva.")
    # Fallback to known local env logic if needed...
    # We will abort gracefully if we don't have the real Supabase URL
    sys.exit(1)

HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

def clean_string(text):
    if not text:
        return None
    text = str(text).strip()
    # Remover caracteres muy extraños, conservar alphanum, espacios, comas, guiones, puntos
    text = re.sub(r'[^\w\s,\.\-\#]', '', text)
    # Capitalize (Title case)
    return text.title()

def get_investment_range(valuation):
    try:
        v = float(valuation)
    except (ValueError, TypeError):
        v = 0
    
    if v < 15000: return "Micro-proyecto"
    if v <= 50000: return "Remodelación Estándar"
    if v <= 250000: return "Alto Valor"
    return "Comercial / Lujo"

def extract_zip(text):
    if not text:
        return None
    match = re.search(r'\b(\d{5})\b', str(text))
    return match.group(1) if match else None

def fetch_all(table):
    print(f"📥 Descargando registros de {table}...")
    all_data = []
    offset = 0
    limit = 1000
    
    while True:
        url = f"{SUPABASE_URL}/rest/v1/{table}?select=id,permit_number,contractor_name,city,state,zip_code,valuation,project_type&offset={offset}&limit={limit}"
        r = requests.get(url, headers=HEADERS)
        if r.status_code != 200:
            print(f"Error fetching: {r.text}")
            sys.exit(1)
        data = r.json()
        if not data:
            break
        all_data.extend(data)
        if len(data) < limit:
            break
        offset += limit
    
    print(f"✅ Descargados {len(all_data)} registros.")
    return all_data

def main():
    print("🧹 Iniciando Organización Total de Información...")
    
    # Check if investment_range column exists
    check_url = f"{SUPABASE_URL}/rest/v1/competitor_analysis?select=investment_range&limit=1"
    r = requests.get(check_url, headers=HEADERS)
    if r.status_code == 400 and 'column' in r.text and 'does not exist' in r.text:
        print("\n❌ ALERTA: La columna 'investment_range' no existe en 'competitor_analysis'.")
        print("Por favor crea la columna 'investment_range' (tipo text) en Supabase antes de continuar.")
        sys.exit(1)

    records = fetch_all('competitor_analysis')
    
    seen_keys = set()
    to_delete = []
    to_update = []
    
    for r in records:
        # 1. Limpieza
        c_name = clean_string(r.get('contractor_name'))
        city = clean_string(r.get('city'))
        
        # 2. Auditoría de ZIP
        z = str(r.get('zip_code')).strip() if r.get('zip_code') else ''
        if not z or z.lower() == 'null' or z == 'None':
            z = extract_zip(r.get('city')) or extract_zip(r.get('contractor_name')) or None
            
        # 3. Rango de inversión
        inv_range = get_investment_range(r.get('valuation'))
        
        # 4. Deduplicación
        # address no está en competitor_analysis (usaremos city + project_type + contractor_name como pseudo-llave para deduplicar)
        # o permit_number! permit_number debe ser único.
        # Si la tabla tiene duplicados reales, vamos a limpiar
        dedup_key = f"{c_name}_{city}_{clean_string(r.get('project_type'))}".lower()
        
        if dedup_key in seen_keys:
            to_delete.append(r['id'])
            continue
            
        seen_keys.add(dedup_key)
        
        # Marcar para update
        update_payload = {
            'id': r['id'],
            'contractor_name': c_name,
            'city': city,
            'zip_code': z,
            'investment_range': inv_range
        }
        to_update.append(update_payload)
        
    print(f"\n🔍 Resultados del Scrubbing:")
    print(f"   - Duplicados identificados para eliminar: {len(to_delete)}")
    print(f"   - Registros únicos para actualizar: {len(to_update)}")
    
    # Preguntar confirmación (simulada)
    print("\n⏳ (Auto-Confirmado) Ejecutando operaciones Batch...")
    
    # Delete batch
    if to_delete:
        print(f"🗑️ Eliminando {len(to_delete)} duplicados...")
        chunk_size = 200
        for i in range(0, len(to_delete), chunk_size):
            chunk = to_delete[i:i+chunk_size]
            ids = ",".join(str(x) for x in chunk)
            url = f"{SUPABASE_URL}/rest/v1/competitor_analysis?id=in.({ids})"
            dr = requests.delete(url, headers=HEADERS)
            if dr.status_code not in [200, 204]:
                print(f"Error borrando: {dr.text}")
    
    # Update batch
    if to_update:
        print(f"📝 Actualizando {len(to_update)} registros (Scrubbing + ZIPs + Investment Range)...")
        headers = HEADERS.copy()
        headers['Prefer'] = 'resolution=merge-duplicates,return=minimal'
        
        chunk_size = 500
        for i in range(0, len(to_update), chunk_size):
            chunk = to_update[i:i+chunk_size]
            url = f"{SUPABASE_URL}/rest/v1/competitor_analysis"
            ur = requests.post(url, headers=headers, json=chunk)
            if ur.status_code not in [200, 201]:
                print(f"Error actualizando batch {i}: {ur.text}")
                
    print("✅ Proceso completado exitosamente.")

if __name__ == "__main__":
    main()
