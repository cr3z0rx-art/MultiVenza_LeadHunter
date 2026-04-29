# MultiVenza LeadHunter — Manual de Operaciones
> Claude Code lee este archivo automáticamente al iniciar cada sesión.
> No es necesario re-explicar el contexto del proyecto.

---

## Identidad del Proyecto

**Empresa:** MultiVenza LLC
**Sistema:** LeadHunter v1.0.0
**Estrategia:** Lead generation basado en permisos de construcción públicos para Florida West Coast
**Stack:** Node.js 18+, ArcGIS REST API, Apify, FireCrawl, csv-writer

---

## Modelo de Negocio

**Foco principal:** Permisos de construcción = señal de compra activa. El propietario ya inició el proceso — MultiVenza entra como partner/contratista antes de que asigne a alguien más.

### Prioridad de leads (orden de valor)
1. **No-GC + PREMIUM** — Sin contratista asignado en zona premium. Acceso directo al dueño, mercado de alto valor. Señal máxima.
2. **No-GC + Roof 15yr** — Sin contratista + techo crítico. Presión de aseguradora. Urgencia real.
3. **PREMIUM solo** — Zona premium aunque tenga contratista. Vale contactar por el volumen del contrato.
4. **No-GC solo** — Cualquier ciudad de la lista. Siempre priorizar sobre leads con GC asignado.

### Modelo financiero (dos columnas — visibles en outputs)
| Columna | Definición | Cálculo |
|---|---|---|
| **Total Project Value (TPV)** | Valor real del contrato de obra | `max(valuation, $250k)` en PREMIUM FL, `valuation` en STANDARD |
| **Est. Net Profit (35%)** | Utilidad neta de la empresa después de materiales, subcontratistas y overhead | `TPV × 0.35` |

> **Dato privado — NO incluir en outputs:** La participación interna de MultiVenza es información confidencial. Nunca calcular ni mostrar en CSVs, reportes Markdown ni consola pública.

> **Regla del piso PREMIUM:** Los permisos en Siesta Key, Longboat Key y Lakewood Ranch declaran solo el costo de materiales (~$15k–$50k). El contrato real de obra supera $250,000. Siempre aplicar el piso de $250,000 para calcular TPV en estas zonas. Esta regla solo aplica a ciudades PREMIUM de Florida, no a Georgia ni Illinois.

---

## Geografía — Multi-Estado

### Regla de Oro (Regla de Valuación Mínima)
| Estado | Umbral Mínimo | Descripción |
|---|---|---|
| **Florida** | ≥ $10,000 | Mercado tradicional de MultiVenza |
| **Georgia** | > $15,000 | "Filtro de Hierro" para Atlanta Premium |
| **Illinois** | ≥ $15,000 | Mercado de Chicago |

### Ciudades objetivo por estado
- **Florida:** Siesta Key · Lido Key · St. Armands · Lakewood Ranch · Longboat Key · Bradenton · Palmetto · Laurel · Venice · Nokomis · North Port · St. Petersburg · Port Charlotte · Punta Gorda · Tampa
- **Georgia:** Atlanta · Alpharetta · Sandy Springs · Marietta · Lawrenceville · Duluth · Decatur
- **Illinois:** Chicago · Evanston · Skokie · Cicero

### Ciudades PREMIUM (piso $250k aplicado - solo Florida)
- **Siesta Key** — mercado de mayor valor/m² en Sarasota County
- **Longboat Key** — residencias de lujo, propiedades >$2M
- **Lakewood Ranch** — top-10 EE.UU. en ventas de nuevas viviendas 2024–2026

### Condados activos
- **Florida**
  - **Hillsborough** — datos reales vía ArcGIS REST API (Accela público)
  - **Sarasota** — datos demo realistas (no existe API pública; Accela ACA requiere login)
- **Georgia**
  - **Fulton** — datos reales vía Accela ACA (Atlanta)
  - **Gwinnett** — datos reales vía Tyler EnerGov
- **Illinois**
  - **Cook** — datos reales vía Chicago Data Portal

---

## Reglas de Negocio (rules.js)

### Regla No-GC
Campo `contractorName` = null, vacío, "OWNER BUILDER", "NONE", "HOMEOWNER" → flag `noGC: true` → +40 puntos de score.
**Por qué importa:** Sin GC, el propietario es el tomador de decisión directo. No hay intermediario que bloquee el acceso.

### Regla de los 15 Años (15-Year Roof Rule)
- Techo ≥ 15 años → clasificación `critical` → +50 pts. Citizens Insurance y aseguradoras de FL exigen reemplazo. Urgencia real.
- Techo 12–14 años → clasificación `warm` → +25 pts. Acercarse antes que la competencia.
- **Fuente del dato:** `roofYear` del permiso, o `permitDate` como proxy para permisos de re-roof.

### Sistema de scoring (0–100)
| Factor | Puntos |
|---|---|
| Base | 10 |
| Categoría Roofing | +20 |
| Categoría CGC | +15 |
| Categoría Home Builder | +10 |
| No-GC | +40 |
| Roof Critical (15+ yr) | +50 |
| Roof Warm (12–14 yr) | +25 |
| Ciudad PREMIUM | +20 |
| Valuación alta (>$50k) | +15 |
| Permiso reciente (<90 días) | +5 |
| Permiso expirado | +10 |

---

## Stack de Enriquecimiento de Contactos

**Ventaja competitiva MultiVenza:** Permiso Real (ArcGIS) + Teléfono de Google Maps (Outscraper) + Inteligencia de Urgencia (Claude)

| Paso | Herramienta | Costo | Estado |
|---|---|---|---|
| Datos de permiso | ArcGIS REST API (Hillsborough) | Gratis | ✅ Activo |
| Nombre del propietario | sc-pa.com / hcpafl.org (Property Appraiser) | Gratis | Manual |
| Teléfono comercial | **Outscraper Google Maps API** | Por crédito | 🔑 Necesita key |
| Enriquecimiento personal | BatchSkipTracing ($0.12/registro) | $0.12/lead | Opcional |
| CRM destino | GoHighLevel (GHL) | Plan mensual | Pendiente |

**Regla de enriquecimiento:**
- Outscraper es la fuente oficial de teléfonos — NO usar Apollo.io ni RocketReach
- Outscraper funciona bien para leads **CGC/comerciales** (tienen listing en Google Maps)
- Para leads **residenciales** (roofing, homeBuilders): usar Property Appraiser + BatchSkipTracing
- Clasificación DIAMANTE = ciudad PREMIUM (Siesta Key / Longboat Key / Lakewood Ranch) + teléfono verificado por Outscraper

**Output enriquecido:** `output/LEADS_DIAMANTE_CON_TELEFONO_{fecha}.csv`

---

## Fuentes de Datos

### Florida
#### Hillsborough County (LIVE — datos reales)
```
Endpoint: https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer/4
Campos:   PERMIT__, TYPE, ISSUED_DATE, ADDRESS, CITY (formato "Tampa 33615"), Value, DESCRIPTION, STATUS
Tipos relevantes: Residential New Construction, Residential Building Alterations (Renovations), Residential Miscellaneous
Datos hasta: 2026-04-02 (actualización no diaria — usar --days=30 mínimo)
```

#### Sarasota County (DEMO — no existe API pública)
```
Portal oficial: aca-prod.accela.com/SARASOTACO/ — requiere sesión autenticada
Alternativa futura: buscar en sarasota.maps.arcgis.com o scgov.net
Workaround actual: datos demo realistas con ciudades y valores reales de mercado
```

### Georgia
#### Fulton County (LIVE — datos reales)
```
Sistema: Accela ACA
URL: https://aca-prod.accela.com/ATLANTA_GA/Default.aspx
Driver: scripts/drivers/accela_driver.js
Extracción: Permisos + historial de contratistas
```

#### Gwinnett County (LIVE — datos reales)
```
Sistema: Tyler EnerGov
URL: https://gwinnettcounty-energovpub.tylerhost.net/apps/selfservice
Driver: scripts/drivers/energov_driver.js
Extracción: Permisos + historial de contratistas
```

### Illinois
#### Cook County / Chicago (LIVE — datos reales)
```
Sistema: Chicago Data Portal
Extractor: scripts/extract_chicago.js
Tipos relevantes: Porch Construction, Basement Finishing, Commercial Build-out, Roofing, Remodel
```

### Property Appraiser (nombres de propietarios — gratis)
```
Sarasota:     https://www.sc-pa.com/propertysearch/
Hillsborough: https://www.hcpafl.org/property-search
```

---

## Archivos del Proyecto

| Archivo | Función |
|---|---|
| `src/arcgis_extractor.js` | Extractor principal — ArcGIS REST API (Hillsborough real + Sarasota demo) |
| `src/processor.js` | Pipeline: filtros → categoría → score → TPV/NetProfit/PartnerShare → CSV/JSON |
| `src/extractor.js` | Extractor legacy vía Apify puppeteer-scraper (bloqueado por proxies) |
| `src/utils/rules.js` | Motor de reglas: No-GC, 15-Year Rule, detectCategory |
| `src/utils/financials.js` | Cálculos financieros unificados: TPV, Net Profit 35%, umbrales por estado |
| `src/utils/logger.js` | Logger con timestamps, niveles, output a archivo |
| `src/crm_auditor.js` | Reconciliación contra CRM (HubSpot / GoHighLevel / Generic REST) |
| `scripts/run_diamond_leads.js` | Ejecución principal — extrae + procesa + reporte Diamond |
| `scripts/run_sarasota_hillsborough.js` | Ejecución enfocada Sarasota + Hillsborough |
| `scripts/leads_atlanta_premium.py` | Extracción y procesamiento de leads premium de Atlanta |
| `scripts/extract_chicago.js` | Extracción de leads de Chicago |
| `scripts/extract_georgia.js` | Extracción de leads de Georgia |
| `scripts/drivers/base_driver.js` | Driver base para scrapers de permisos |
| `scripts/drivers/accela_driver.js` | Driver específico para sistemas Accela ACA (Fulton) |
| `scripts/drivers/energov_driver.js` | Driver específico para sistemas Tyler EnerGov (Gwinnett) |
| `scripts/consolidate_leads.py` | Consolidación de leads multi-estado |
| `scripts/update_dashboard.py` | Actualización del dashboard multi-estado |
| `scripts/generate_search_urls.js` | Generador de URLs de búsqueda manual para enriquecimiento de contactos |
| `config.json` | Configuración maestra (ciudades, scoring, comisión, filtros) |
| `config_atlanta_premium.json` | Configuración específica para Atlanta Premium |
| `config_chicago.json` | Configuración específica para Chicago |
| `.env` | API keys: APIFY_TOKEN, FIRECRAWL_API_KEY |

### Comandos rápidos
```bash
npm run diamond          # Run principal (30 días, 200 leads/condado)
npm run diamond:14d      # Últimos 14 días, 300 leads/condado
node scripts/run_diamond_leads.js --days=7 --max=500 --top=25
node scripts/generate_search_urls.js --open   # Abre búsquedas Google en navegador
```

---

## Restricciones Operativas

- **No scraping de Whitepages / Spokeo** — viola ToS + riesgo TCPA ($500–$1,500/contacto)
- **No automatizar búsquedas Google** — viola ToS de Google
- **Enriquecimiento de contactos permitido:** BatchSkipTracing ($0.12/registro), BeenVerified Business API, Property Appraiser público
- **Números de teléfono:** obtener solo de fuentes licenciadas con permiso B2B
- **Datos de permisos:** 100% público, registro gubernamental — sin restricciones

---

## Outputs Generados

Todos en `./output/`. Formato de nombre según estado:
- Florida: `leads_florida_wc_{categoria}_{fecha}.csv/json`
- Georgia: `leads_atlanta_premium_{fecha}.csv/json`
- Illinois: `leads_chicago_{fecha}.csv/json`
- Consolidado: `consolidated_leads_{fecha}.json`

### Columnas CSV (en orden)
Lead ID · Score · Tier · Tags · Category · Permit # · Permit Type · Permit Date · Status · Address · City · County · State · ZIP · Owner · Contractor · Permit Valuation ($) · **Total Project Value ($)** · **Est. Net Profit 35% ($)** · Market Note · Roof Age · Roof Classification · No-GC · Roof Critical · Roof Note · Source · Processed At

> **REGLA DE CONFIDENCIALIDAD:** La columna `MultiVenza Partner Share` está eliminada de todos los outputs. No agregarla en CSVs, reportes Markdown ni consola.

### Dashboard Multi-Estado
El archivo `output/DASHBOARD_MULTI_STATE.html` muestra leads de todos los estados con:
- Filtros por estado, tier y tipo de permiso
- Resaltado visual para "High-Ticket Leads" de Georgia
- KPIs por estado
- Soporte para la "Regla de Oro" de cada estado (FL≥$10k, GA>$20k, IL≥$15k)

---

## Protocolo de Actuación — MultiVenza LLC

### Prioridad de trabajo
1. **Máxima prioridad:** Leads No-GC en zonas PREMIUM con TPV ≥ $250,000
2. **Segunda prioridad:** Cualquier lead No-GC con señal de techo crítico (15+ años)
3. **Cambios de estrategia** (ciudades, filtros, scoring): actualizar `config.json` Y documentar el cambio en este archivo

### Eficiencia de tokens
- **NUNCA** leer archivos de `node_modules/`
- **NUNCA** leer un CSV o JSON completo — usar `Grep` para headers, leer solo las filas necesarias
- Usar `Glob` para localizar archivos antes de `Read`
- Para archivos grandes: leer por secciones con `offset` + `limit`

### Persistencia entre sesiones
- Leer `session_state.json` al iniciar para retomar contexto
- Actualizar `session_state.json` al terminar cada tarea
- Al terminar: dar **resumen técnico de 3 líneas máximo**
- Todo cambio en estrategia queda en este archivo (`CLAUDE.md`)

### Output
- Reportes siempre en `./output/` con formato: Total Project Value · Est. Net Profit (35%)
- **PROHIBIDO** incluir columna Partner Share o participación interna en cualquier output
- Responder siempre en **español**

---

## Reglas de Oro — Datos y Reportes

> Estas reglas son permanentes y tienen prioridad sobre cualquier instrucción anterior.

1. **SOLO datos reales.** Nunca usar ni generar datos demo/sintéticos para leads. Si no hay datos reales de una fuente, indicarlo explícitamente y no fabricar registros.
2. **Archivo de referencia real:** `output/BASE_DATOS_LEADS_REALES_MULTIVENZA.csv` — este es el master de leads reales cuando esté disponible. Usarlo como fuente única para skip tracing y reportes de socio.
3. **Sin Partner Share en outputs.** La columna `MultiVenza Partner Share` y cualquier variante del 35% de participación interna está **prohibida** en CSVs, reportes Markdown y consola. Solo mostrar: Total Project Value + Est. Net Profit (35%).
4. **Skip tracing residencial:** usar BatchData.io (`scripts/run_batchdata_skiptracing.js`) con nombres reales del Property Appraiser. Nunca fabricar nombres placeholder.
5. **Outscraper:** exclusivamente para leads CGC/comerciales con listing en Google Maps. No usar para residencias.
6. **Regla de Oro por Estado:** Aplicar umbrales de valuación específicos por estado: FL≥$10k, GA>$20k ("Filtro de Hierro"), IL≥$15k.
7. **Net Profit Rate uniforme:** 35% en todos los estados.
8. **Deduplicación:** Usar clave compuesta (state + permit_number) para evitar duplicados entre estados.

---

## Contexto de Sesiones Anteriores

- **Apify:** actor `puppeteer-scraper` configurado pero bloqueado por proxies RESIDENTIAL en ambos portales. Usar `arcgis_extractor.js` en su lugar.
- **FireCrawl:** API key guardada en `.env` (FIRECRAWL_API_KEY). Portales de condados bloqueados también. Créditos disponibles para otros usos.
- **ArcGIS Hillsborough:** endpoint confirmado funcional. Máximo dato disponible: 2026-04-02. Sin campo de contratista (todos quedan como No-GC).
- **Sarasota demo data:** OBSOLETO — reemplazado por `BASE_DATOS_LEADS_REALES_MULTIVENZA.csv`. Los permisos SC-BLD-26-XXXXXX eran sintéticos y no deben usarse.
- **BatchData skip tracing:** script en `scripts/run_batchdata_skiptracing.js` — acepta CSV con columnas address/city/zip/ownerName, genera CSV de cargue masivo.
- **Expansión Atlanta:** Implementada con "Filtro de Hierro" (>$20k) y etiqueta "HIGH-TICKET" para leads premium.
- **Expansión Chicago:** Implementada con umbral ≥$15k y soporte en dashboard multi-estado.
- **Dashboard Multi-Estado:** Nuevo dashboard con soporte para FL, GA, IL y resaltado visual para leads premium.
