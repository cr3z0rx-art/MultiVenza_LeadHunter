# Directiva: Actualización de Dashboard Multi-Estado y Regla de Oro (LeadHunter)

## Objetivo
1. **Consolidación Multiregión:** Integrar leads de Florida, Georgia e Illinois en un único Dashboard.
2. **Aplicación de Regla de Oro:** Filtrar estrictamente leads con valuación > $10,000.
3. **Normalización de Datos:** Unificar los diferentes esquemas de JSON a un formato compatible con el Dashboard actual.

## Entradas
- `output/leads_florida_wc_all_2026-04-16.json` (Prioridad Florida)
- `output/leads_georgia_raw.json` (Expansión GA)
- `output/leads_chicago_raw.json` (Expansión IL)
- `output/DASHBOARD_FAST_CASH.html` (Template base)

## Salidas
- `output/DASHBOARD_FAST_CASH.html`: Dashboard actualizado con la data inyectada.

## Lógica y Pasos a Seguir
1. **Carga y Filtrado:**
   - Leer cada archivo JSON.
   - Convertir `valuation` a flotante si es necesario.
   - **Regla de Oro:** Si `valuation <= 10000`, descartar el lead.
2. **Normalización por Estado:**
   - **FL:** Mapear `ownerName` -> `owner`, `permitNumber` -> `permit`, extraer `estNetProfit`.
   - **GA:** Mapear `ownerName` -> `owner`. Calcular `net_profit` como `valuation * 0.35` (margen estándar).
   - **IL:** Mapear `Owner_Name` -> `owner`, `Permit_Number` -> `permit`. Usar `Net_Profit_30`.
3. **Inyección en Dashboard:**
   - Leer el contenido de `output/DASHBOARD_FAST_CASH.html`.
   - Localizar la variable `const leadsData = [...];`.
   - Reemplazar el contenido de la variable con el nuevo set de datos consolidado.
   - Actualizar el título del Dashboard a "MultiVenza: Multi-State Pipeline".

## Restricciones y Casos Borde
- **Nombres Desconocidos:** Si el dueño contiene "Unknown" o "Owner GA/Client", mantener la lógica de marcado visual (rojo/itálica) en el HTML.
- **Formato de Archivo:** Asegurarse de que el script de Python sea idempotente y no corrompa el HTML si se ejecuta varias veces.
- **Encoding:** Usar UTF-8 para evitar problemas con caracteres especiales en direcciones.
