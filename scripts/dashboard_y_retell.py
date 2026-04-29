import csv
import json
import os
import glob
from pathlib import Path

# Paths
BASE_DIR = Path(r"c:\Users\yildr\Desktop\MultiVenza_LeadHunter")
OUTPUT_DIR = BASE_DIR / "output"
FAST_CASH_CSV = OUTPUT_DIR / "FAST_CASH_PRIORITY.csv"
DASHBOARD_HTML = OUTPUT_DIR / "DASHBOARD_FAST_CASH.html"
SKIP_TRACING_CSV = OUTPUT_DIR / "LEADS_DIAMANTE_CON_TELEFONO_2026-04-16.csv"

# Thresholds for VVIP Leads
VALUATION_THRESHOLD = 10000
PROFIT_THRESHOLD = 8000

def get_latest_file(pattern):
    files = glob.glob(str(OUTPUT_DIR / pattern))
    if not files: return None
    return Path(max(files, key=os.path.getmtime))

def load_enrichment_map():
    """Build a map of Permit Number -> Real Name/Phone from skip tracing data."""
    enrich_map = {}
    if SKIP_TRACING_CSV.exists():
        with open(SKIP_TRACING_CSV, newline='', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                permit = row.get("Permiso #")
                if not permit: continue
                
                # Priority: Google Maps Name > Owner (if not Owner X)
                g_name = row.get("Nombre en Google Maps", "")
                prop_owner = row.get("Propietario", "")
                phone = row.get("Teléfono (Outscraper)", "")
                
                name = ""
                if g_name and "LLC" in g_name.upper(): name = g_name
                elif prop_owner and not prop_owner.startswith("Owner "): name = prop_owner
                elif g_name: name = g_name
                else: name = prop_owner

                enrich_map[permit] = {"name": name, "phone": phone}
    return enrich_map

def build_dashboard():
    enrich_map = load_enrichment_map()
    all_leads = []
    
    # --- FLORIDA CONSOLIDATION ---
    fl_sources = [FAST_CASH_CSV]
    cgc_file = get_latest_file("leads_florida_wc_cgc_*.csv")
    hb_file = get_latest_file("leads_florida_wc_homeBuilders_*.csv")
    if cgc_file: fl_sources.append(cgc_file)
    if hb_file: fl_sources.append(hb_file)

    for fs in fl_sources:
        if fs and fs.exists():
            with open(fs, newline='', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    val_str = (row.get("Valuation ($)") or row.get("Permit Valuation ($)") or "0").replace(",", "").strip()
                    val = float(val_str) if val_str else 0
                    
                    permit_type = (row.get("Fast_Cash_Type") or row.get("Permit Type") or "REMODEL").upper()
                    owner = (row.get("Owner_Name") or row.get("Owner") or "Unknown")
                    permit_num = (row.get("Permit_Number") or row.get("Permit #") or "N/A")
                    
                    # ENRICHMENT FALLBACK
                    if (owner == "Unknown" or owner.startswith("Owner ")) and permit_num in enrich_map:
                        enriched = enrich_map[permit_num]
                        if enriched["name"]: owner = enriched["name"]

                    net_profit = val * 0.35
                    
                    if val >= VALUATION_THRESHOLD and net_profit >= PROFIT_THRESHOLD and "SERVICE" not in permit_type and "REPAIR" not in permit_type:
                        all_leads.append({
                            "state": "FL",
                            "type": permit_type if len(permit_type) < 25 else (row.get("Category") or "NEW CONST").upper(),
                            "permit": permit_num,
                            "owner": owner,
                            "address": row.get("Address", "N/A"),
                            "city": row.get("City", "N/A"),
                            "valuation": val,
                            "net_profit": net_profit,
                            "phone": enrich_map.get(permit_num, {}).get("phone", ""),
                            "status": row.get("Status", "Issued")
                        })

    json_data = json.dumps(all_leads)
    
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>MultiVenza FL: Enriched Pipeline</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
    <style>
        body {{ font-family: 'Outfit', sans-serif; background-color: #020617; color: #f8fafc; }}
        .glass {{ background: rgba(15, 23, 42, 0.8); backdrop-filter: blur(20px); border: 1px solid rgba(45, 212, 191, 0.1); }}
        .premium-border {{ border: 2px solid #2dd4bf; box-shadow: 0 0 30px rgba(45, 212, 191, 0.2); }}
    </style>
</head>
<body class="min-h-screen p-8 bg-slate-950">
    <div class="max-w-7xl mx-auto space-y-8">
        <header class="flex flex-col md:flex-row justify-between items-center pb-8 border-b border-slate-800 gap-6">
            <div class="space-y-1">
                <h1 class="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-cyan-500">
                    FLORIDA ENRICHED
                </h1>
                <p class="text-slate-500 font-bold uppercase tracking-[0.2em] text-xs">VVIP Verification • Data Enriched</p>
            </div>
            <div class="text-right">
                <p class="text-teal-500 font-black text-4xl" id="total-profit-header">$0</p>
                <p class="text-[10px] text-slate-500 uppercase tracking-widest">Total VVIP Net Profit</p>
            </div>
        </header>

        <div id="leads-container" class="glass rounded-[2rem] overflow-hidden shadow-2xl premium-border">
            <div class="p-8 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/50">
                <h2 class="text-xl font-black text-white uppercase tracking-wider">Florida WC Pipeline</h2>
                <input type="text" id="searchInput" placeholder="Search by Owner, Address or City..." class="bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-teal-500 w-80">
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left" id="leads-table">
                    <thead class="bg-slate-950 text-slate-500 uppercase text-[9px] tracking-[0.2em] font-black border-b border-slate-800">
                        <tr>
                            <th class="px-8 py-6">Status</th>
                            <th class="px-8 py-6">Category</th>
                            <th class="px-8 py-6">Owner / Phone / Address</th>
                            <th class="px-8 py-6 text-right">Value</th>
                            <th class="px-8 py-6 text-right font-black text-teal-400">PROFIT</th>
                        </tr>
                    </thead>
                    <tbody id="tableBody" class="divide-y divide-slate-800/10"></tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        const leadsData = {json_data};

        function formatCurrency(num) {{ 
            return new Intl.NumberFormat('en-US', {{ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }}).format(num); 
        }}

        function render() {{
            const term = document.getElementById('searchInput').value.toLowerCase();
            const filtered = leadsData.filter(l => (l.owner + l.address + l.city + l.permit).toLowerCase().includes(term));
            
            const tbody = document.getElementById('tableBody');
            tbody.innerHTML = '';
            
            let totalProfit = 0;

            filtered.forEach(l => {{
                totalProfit += l.net_profit;
                const row = document.createElement('tr');
                row.className = "hover:bg-teal-500/5 transition-all duration-300";
                
                const isUnknown = l.owner.includes("Unknown") || l.owner.includes("Owner ");
                const ownerClass = isUnknown ? "text-red-400/80 italic font-medium" : "text-white font-black";
                const phoneHtml = l.phone ? `<div class="text-xs text-teal-400 font-bold mt-1 tracking-widest">📞 ${{l.phone}}</div>` : "";

                row.innerHTML = `
                    <td class="px-8 py-8"><span class="px-4 py-1.5 rounded-full bg-slate-900 text-[10px] font-black border border-slate-700 uppercase tracking-widest text-slate-400">${{l.status}}</span></td>
                    <td class="px-8 py-8"><span class="text-teal-400 font-black text-xs uppercase tracking-widest">${{l.type}}</span></td>
                    <td class="px-8 py-8">
                        <div class="${{ownerClass}} text-xl tracking-tight">${{l.owner}}</div>
                        ${{phoneHtml}}
                        <div class="text-xs text-slate-500 font-bold uppercase tracking-widest mt-2">${{l.address}}, ${{l.city}}</div>
                        <div class="text-[9px] text-slate-600 mt-1 uppercase">ID: ${{l.permit}}</div>
                    </td>
                    <td class="px-8 py-8 text-right font-bold text-slate-400 text-sm font-mono tracking-tighter">${{formatCurrency(l.valuation)}}</td>
                    <td class="px-8 py-8 text-right">
                        <div class="text-teal-400 font-black text-3xl tracking-tighter">${{formatCurrency(l.net_profit)}}</div>
                    </td>
                `;
                tbody.appendChild(row);
            }});
            
            document.getElementById('total-profit-header').innerText = formatCurrency(totalProfit);
        }}

        document.getElementById('searchInput').oninput = render;
        render();
    </script>
</body>
</html>"""
    with open(DASHBOARD_HTML, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"[OK] Enriched Dashboard written to {DASHBOARD_HTML}")

if __name__ == "__main__":
    build_dashboard()
