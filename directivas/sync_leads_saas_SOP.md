# Directiva: Sincronización de Leads al SaaS API (SOP)

## Objetivo
Sincronizar leads procesados (Florida, Illinois, etc.) desde archivos locales en la carpeta `output/` hacia la API central del SaaS para su visualización en el CRM/Dashboard web.

## Entradas
- Archivos JSON en `output/`:
    - Florida: `leads_florida_wc_all_YYYY-MM-DD.json`
    - Illinois: `leads_chicago_raw.json` (o similar)
- Variables de Entorno (`.env`):
    - `SAAS_API_URL`: URL base de la aplicación SaaS.
    - `SAAS_API_KEY`: Token de autenticación para la API.

## Salidas
- Reporte en consola del estado de la sincronización:
    - Número de leads insertados (nuevos).
    - Número de leads actualizados (existentes).
    - Número de leads omitidos (sin cambios o errores).

## Lógica y Pasos a Seguir
1. **Identificación del Archivo:**
   - Por defecto, buscar el archivo más reciente que coincida con el patrón `leads_florida_wc_all_*.json` en la carpeta `output/`.
   - Permitir la especificación manual mediante el flag `--file=ruta/al/archivo.json`.
2. **Carga de Datos:**
   - Leer y parsear el contenido JSON.
   - Validar que el array de leads no esté vacío.
3. **Mapeo y Transformación (Interno):**
   - El script utiliza `scripts/lib/saas_sync.js` para transformar el esquema local al esquema esperado por la API (mapeo de campos como `valuation` -> `estimated_valuation`, asignación de `tier` según TPV, etc.).
4. **Ejecución del Sync:**
   - Realizar una petición POST a `/api/sync`.
   - Incluir los headers `x-api-key` y `x-scraper-source`.
5. **Manejo de Lotes (Batching):**
   - El `batch_id` se genera automáticamente basado en el estado y la fecha del archivo (ej: `FL-2026-04-30`).

## Restricciones y Casos Borde
- **Falta de Configuración:** Si `SAAS_API_URL` o `SAAS_API_KEY` no están en el `.env`, el proceso debe fallar con un mensaje claro.
- **Error 401 (Vercel Deployment Protection):** Si la URL apunta a un despliegue de Vercel con protección activada, la API devolverá un error 401 con un HTML de autenticación.
    - **Solución:** Usar el dominio de producción configurado en Vercel (que no tenga protección) o añadir el header de bypass si se dispone del token.
- **Leads sin ID:** Asegurarse de que cada lead tenga un identificador único (como el `permit_number`) para evitar duplicados en el SaaS.
- **Límites de Tamaño:** Para lotes extremadamente grandes (>1000 leads), monitorear posibles timeouts de la API (aunque el script actual envía el lote completo).
- **Idempotencia:** El script puede ejecutarse varias veces sobre el mismo archivo; la API del SaaS se encarga de decidir si actualiza o ignora registros existentes.
