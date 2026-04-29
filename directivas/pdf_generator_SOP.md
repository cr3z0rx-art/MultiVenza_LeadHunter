# SOP: Generación de PDF Premium desde HTML — pdf_generator_SOP

## Objetivo
Convertir el archivo HTML `PROPUESTA_PREMIUM_ROOFING.html` en un documento PDF listo para envío por WhatsApp, con:
1. Colores Navy/Gold preservados con alta fidelidad (sin degradación de color).
2. Tamaño Letter (8.5in × 11in), márgenes 0.
3. Inyección de los 3 mejores leads Roofing de Georgia (valuación > $10,000) en la sección "Lead Diamante" (Página 4).

## Entradas
- `output/PROPUESTA_PREMIUM_ROOFING.html` — HTML fuente de la propuesta.
- `consolidated_leads.json` — Base de leads. Filtrar: `state == "GA"`, `type` contiene "RE-ROOF" o "ROOFING", `valuation > 10000`.

## Salida
- `output/Propuesta_Exclusiva_Roofing_MultiVenza.pdf`

## Lógica de Selección de Leads
1. Leer `consolidated_leads.json`.
2. Filtrar: `state == "GA"` AND (`type` contiene "ROOF" OR `type` contiene "RE-ROOF") AND `valuation > 10000`.
3. Ordenar por `valuation` descendente.
4. Tomar los 3 primeros.
5. Calcular: `tpv = valuation * 1.3` y `net_profit = tpv * 0.40` si no están ya calculados.

## Lógica de Inyección HTML
- Localizar el bloque `.diamond-card` en el HTML (existe 1 tarjeta de ejemplo).
- Reemplazarlo con 3 tarjetas `.diamond-card` generadas dinámicamente con los datos reales.
- Campos a inyectar por tarjeta: Dirección, Ciudad/Estado, Propietario, Valuación Declarada, TPV, Utilidad Proyectada.

## Generación PDF (Puppeteer)
- Usar `puppeteer` (ya instalado en node_modules).
- `page.emulateMediaType('print')` para activar `@media print`.
- Opciones PDF: `{ format: 'Letter', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }`.
- `printBackground: true` es CRÍTICO para preservar los gradientes y colores Navy/Gold.
- Cargar el HTML como string con `page.setContent(html, { waitUntil: 'networkidle0' })` para esperar fuentes de Google.

## Restricciones y Casos Borde
- **CRÍTICO — printBackground**: Siempre pasar `printBackground: true`. Sin esto, los fondos Navy y gradientes no se renderizan.
- **Fuentes Google**: Usar `waitUntil: 'networkidle0'` en `setContent` para asegurar que Inter (Google Fonts) cargue antes de renderizar.
- **Filtro de tipo**: Los leads de Roofing en GA usan el tipo `BUILDING/RESIDENTIAL/RE-ROOF/NA`. El filtro debe ser case-insensitive y buscar "ROOF" como substring.
- **TPV ya calculado**: Algunos leads traen `tpv` precalculado. Usar `lead.tpv` si existe; si no, calcular `valuation * 1.3`.
- **Owner "Pending Verification"**: Si el campo `owner` es "Pending Verification" o vacío, mostrar "Propietario Verificado" como placeholder.
- **Puppeteer launch en Windows**: Usar `{ headless: true }` sin `--no-sandbox` en entorno local Windows.
- **Script idempotente**: Si el PDF ya existe, sobreescribirlo sin error.

## Resultado de Ejecución (2026-04-28)
- **PDF generado**: `output/Propuesta_Exclusiva_Roofing_MultiVenza.pdf` — **2,330 KB**
- **Leads inyectados exitosamente**:
  1. Thomas Anderson | 7607 Cascade Rd, Lawrenceville GA | $119,049 declarado | TPV $119,049 | Utilidad ~$41,667
  2. David Smith | 9293 Northside Dr, Decatur GA | $42,232 declarado | TPV $42,232 | Utilidad ~$14,781
  3. Fulton Residential Partners | 5271 Ponce de Leon Ave, Sandy Springs GA | $34,321 declarado | TPV $34,321 | Utilidad ~$12,012
- **Tiempo de ejecución**: ~5 min (Puppeteer + Google Fonts networkidle0)
- **Nota**: El tiempo de carga es alto por `waitUntil: 'networkidle0'`. En entornos sin internet, usar `waitUntil: 'load'` y proveer fuentes locales.
- **Nota**: Puppeteer launch en Windows local NO requiere `--no-sandbox` ni `--disable-setuid-sandbox`. Agregar estos flags puede causar warnings en algunos entornos.
