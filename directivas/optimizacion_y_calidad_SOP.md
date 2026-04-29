# Directiva: Optimización de Rendimiento y Calidad de Datos (LeadHunter)

## Objetivo
1. **Optimización de Rendimiento (Parallelism):**
   - Implementar procesamiento paralelo en `Processor` usando `Promise.all` o un pool de workers para la clasificación de leads.
   - Implementar concurrencia controlada en `Enricher` para llamadas a la API de Outscraper (evitando el loop secuencial `await` con delay fijo).
2. **Mejora de Calidad de Datos:**
   - **Validación de Direcciones:** Integrar opcionalmente la API de Google Maps Geocoding para validar direcciones que no pasen el filtro local.
   - **Limpieza y Normalización:** Asegurar que los nombres de propietarios y direcciones estén en un formato estándar (Title Case, post-procesamiento de sufijos LLC/INC).
3. **Caché de Enriquecimiento:**
   - Implementar un sistema de caché simple (archivo JSON) para evitar llamadas duplicadas a Outscraper para la misma dirección en ejecuciones consecutivas.

## Entradas
- Registros raw obtenidos por los extractores (JS/JSON).
- API Keys (Google Maps, Outscraper) en `.env`.

## Salidas
- Leads procesados con mayor velocidad y precisión.
- Archivo `cache/enrichment_cache.json` (nuevo).

## Lógica y Pasos a Seguir

### Fase 1: Paralelismo en Processor
- Modificar `src/processor.js` para procesar el array de registros usando `Promise.all` con un límite de concurrencia (ej. `p-limit` o similar, o simplemente chunks si es CPU-bound).
- Evaluar si el uso de `worker_threads` es necesario. Dado que la lógica es mayormente scoring, un `Promise.all` sobre funciones asíncronas de validación de direcciones será suficiente si se integran APIs externas.

### Fase 2: Concurrencia en Enricher
- Reemplazar el loop `for...of` con `await search` por un manejador de cola de tareas.
- Establecer un límite de X peticiones por segundo (conforme a los límites de Outscraper).

### Fase 3: Validación de Direcciones (Google Maps)
- Crear `src/utils/geocoder.js` para manejar llamadas a Google Maps API.
- En `src/processor.js`, si `validateAddress` local devuelve `UNVERIFIED`, intentar geocodificar vía API antes de marcar definitivamente como unverified.

### Fase 4: Sistema de Caché
- Antes de llamar a Outscraper, verificar si la dirección ya existe en `.tmp/enrichment_cache.json`.
- Si existe y tiene menos de 30 días, usar el resultado cacheado.

## Trampas Conocidas y Casos Borde
- **Rate Limits:** No exceder los límites de Google Maps o Outscraper. Implementar backoff exponencial si se recibe Error 429.
- **Costos de API:** La geocodificación de Google Maps tiene un costo. Debe ser el último recurso cuando la validación local falla.
- **Consistencia de Datos:** Al paralelizar, asegurar que el orden de los leads se mantenga o se re-ordene por score al final (el script actual ya lo hace).
