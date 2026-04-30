import os
from pathlib import Path

def load_env(p):
    if not p.exists():
        return
    for l in p.read_text().splitlines():
        if '=' in l and not l.startswith('#'):
            k, v = l.split('=', 1)
            os.environ[k.strip()] = v.strip()

root = Path('.')
load_env(root / '.env')
load_env(root / '.env.local')

url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

print(f"URL: {url}")
print(f"KEY FOUND: {bool(key)}")

if url and key:
    import json
    import urllib.request
    
    headers = {
        'apikey': key,
        'Authorization': f'Bearer {key}',
    }
    
    # Query to count leads by state
    query_url = f"{url}/rest/v1/leads?select=state"
    req = urllib.request.Request(query_url, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            counts = {}
            for r in data:
                s = r.get('state') or 'Unknown'
                counts[s] = counts.get(s, 0) + 1
            print("\n--- REPORTE DE LEADS NO-GC ---")
            for st, n in counts.items():
                print(f"{st}: {n}")
            print(f"Total: {len(data)}")
    except Exception as e:
        print(f"Error querying Supabase: {e}")
