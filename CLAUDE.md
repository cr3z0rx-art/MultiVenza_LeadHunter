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

### Modelo financiero (tres columnas)
| Columna | Definición | Cálculo |
|---|---|---|
| **Total Project Value (TPV)** | Valor real del contrato de obra | `max(valuation, $250k)` en PREMIUM, `valuation` en STANDARD |
| **Est. Net Profit (30%)** | Margen neto después de materiales, subcontratistas y overhead | `TPV × 0.30` |
| **MultiVenza Partner Share (35%)** | Participación de MultiVenza sobre el valor total de la obra | `TPV × 0.35` |

> **Regla del piso PREMIUM:** Los permisos en Siesta Key, Longboat Key y Lakewood Ranch declaran solo el costo de materiales (~$15k–$50k). El contrato real de obra supera $250,000. Siempre aplicar el piso de $250,000 para calcular TPV y Partner Share en estas zonas.

---

## Geografía — Florida West Coast

### Ciudades objetivo (targetCities)
Siesta Key · Lido Key · St. Armands · Lakewood Ranch · Longboat Key · Bradenton · Palmetto · Laurel · Venice · Nokomis · North Port · St. Petersburg · Port Charlotte · Punta Gorda · Tampa

### Ciudades PREMIUM (piso $250k aplicado)
- **Siesta Key** — mercado de mayor valor/m² en Sarasota County
- **Longboat Key** — residencias de lujo, propiedades >$2M
- **Lakewood Ranch** — top-10 EE.UU. en ventas de nuevas viviendas 2024–2026

### Condados activos
- **Hillsborough** — datos reales vía ArcGIS REST API (Accela público)
- **Sarasota** — datos demo realistas (no existe API pública; Accela ACA requiere login)

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

### Hillsborough County (LIVE — datos reales)
```
Endpoint: https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer/4
Campos:   PERMIT__, TYPE, ISSUED_DATE, ADDRESS, CITY (formato "Tampa 33615"), Value, DESCRIPTION, STATUS
Tipos relevantes: Residential New Construction, Residential Building Alterations (Renovations), Residential Miscellaneous
Datos hasta: 2026-04-02 (actualización no diaria — usar --days=30 mínimo)
```

### Sarasota County (DEMO — no existe API pública)
```
Portal oficial: aca-prod.accela.com/SARASOTACO/ — requiere sesión autenticada
Alternativa futura: buscar en sarasota.maps.arcgis.com o scgov.net
Workaround actual: datos demo realistas con ciudades y valores reales de mercado
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
| `src/utils/logger.js` | Logger con timestamps, niveles, output a archivo |
| `src/crm_auditor.js` | Reconciliación contra CRM (HubSpot / GoHighLevel / Generic REST) |
| `scripts/run_diamond_leads.js` | Ejecución principal — extrae + procesa + reporte Diamond |
| `scripts/run_sarasota_hillsborough.js` | Ejecución enfocada Sarasota + Hillsborough |
| `scripts/generate_search_urls.js` | Generador de URLs de búsqueda manual para enriquecimiento de contactos |
| `config.json` | Configuración maestra (ciudades, scoring, comisión, filtros) |
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

Todos en `./output/`. Formato de nombre: `leads_florida_wc_{categoria}_{fecha}.csv/json`

### Columnas CSV (en orden)
Lead ID · Score · Tier · Tags · Category · Permit # · Permit Type · Permit Date · Status · Address · City · County · ZIP · Owner · Contractor · Permit Valuation ($) · **Total Project Value ($)** · **Est. Net Profit 30% ($)** · **MultiVenza Partner Share 35% ($)** · Market Note · Roof Age · Roof Classification · No-GC · Roof Critical · Roof Note · Source · Processed At

---

## Protocolo de Actuación — MultiVenza LLC

### Prioridad de trabajo
1. **Máxima prioridad:** Leads No-GC en zonas PREMIUM con Partner Share ≥ $87,500
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
- Reportes siempre en `./output/` con formato Partner Share (TPV / Net Profit 30% / Partner Share 35%)
- CSVs con columnas: Total Project Value ($) · Est. Net Profit 30% ($) · MultiVenza Partner Share 35% ($)
- Responder siempre en **español**

---

## Contexto de Sesiones Anteriores

- **Apify:** actor `puppeteer-scraper` configurado pero bloqueado por proxies RESIDENTIAL en ambos portales. Usar `arcgis_extractor.js` en su lugar.
- **FireCrawl:** API key guardada en `.env` (FIRECRAWL_API_KEY). Portales de condados bloqueados también. Créditos disponibles para otros usos.
- **ArcGIS Hillsborough:** endpoint confirmado funcional. Máximo dato disponible: 2026-04-02. Sin campo de contratista (todos quedan como No-GC).
- **Sarasota:** sin API pública encontrada. Demo data cubre las ciudades premium correctamente.
