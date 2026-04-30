# Expansión del Scraper (ArcGIS & Supabase) SOP

## Objetivo
Expandir las capacidades del scraper de MultiVenza_LeadHunter integrando nuevas regiones (Miami-Dade, Orange County, Palm Beach, Fulton County), ajustando ventanas de tiempo y reforzando los filtros de calidad (No-GC, nichos específicos y exportación a Supabase).

## Cambios Requeridos

1. **Nuevos Endpoints (ArcGIS)**
   - Añadir placeholders para Miami-Dade, Orange County, Palm Beach y Fulton County en `src/arcgis_extractor.js`.
   - Estas URLs y fields pueden necesitar ajustes futuros cuando se tengan los endpoints exactos.

2. **Lógica de Tiempo**
   - El parámetro `daysBack` se reduce por defecto de 30 a 3 días (72 horas) para garantizar frescura de los leads. (Afecta a `arcgis_extractor.js` y `scripts/run_diamond_leads.js`).

3. **Filtro de Nichos (`keywordFilter`)**
   - El nuevo requerimiento exige que el scraper *solo* acepte permits que coincidan con `['ROOF', 'HVAC', 'ELECTRICAL', 'CGC']`.
   - Implementado a través de `config.json` en `filters.keywordFilter` y un check duro en `src/processor.js`.

4. **Filtro Duro No-GC**
   - El procesador debe descartar inmediatamente cualquier registro que tenga un nombre de contratista (`if (record.contractorName) return null;`). Esto restringe el embudo exclusivamente a dueños directos (owner-builders).

5. **Sincronización a Supabase**
   - Incorporar `syncToSupabase()` como alias/puente en `scripts/lib/saas_sync.js` y asegurarse de que sea llamado al finalizar el scrapeo en `scripts/run_diamond_leads.js`.

## Restricciones y Casos Borde Conocidos
- **Nombres de Atributos:** En el procesador, el objeto entrante es `record`, no `lead`, por lo que el filtro de contratista debe usar `record.contractorName`.
- **Falta de Endpoints Reales:** Al no contar con las URLs exactas de ArcGIS para los nuevos condados, se han usado placeholders con una estructura base `FeatureServer/0` o genérica. Si la API falla al conectarse, es por esto.
- **Sarasota Demo:** El condado de Sarasota sigue usando modo demo, no conectar al endpoint en vivo si no es necesario o está ausente.
- **Sincronización a Supabase / Vercel API:** *Nota: No hacer cambios en los campos enviados por saas_sync.js (como añadir county, market_note, government_source, etc.) sin actualizar la tabla en Supabase. Esto causa el error "Could not find the '...' column of 'leads' in the schema cache", rechazando la sincronización.* En su lugar, asegurar que todas las columnas mapeadas en `_mapFLLead` existan en la base de datos antes de hacer deploy o sync.
