# Directiva: Limpieza y Normalización de Leads (Data Scrubbing)

## Objetivo
Normalizar, deduplicar y enriquecer los registros de la base de datos de leads (y competidores) para garantizar un formato limpio, libre de duplicados y con información estructurada que facilite el análisis y las campañas en el CRM.

## Entradas
- Tabla `competitor_analysis` (o `leads`) en Supabase.
- Variable `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del entorno local.

## Salidas
- Nombres de contratistas/owners capitalizados (ej. "JOHN DOE" -> "John Doe").
- Direcciones limpias (remoción de caracteres especiales o espacios redundantes).
- Códigos postales (`zip_code`) extraídos de la dirección si no existen.
- Eliminación de registros duplicados basados en la combinación `(address, project_type)`.
- **Nueva segmentación**: Columna `investment_range` calculada a partir de `valuation`.

## Lógica y Pasos a Seguir
1. **Validación de Schema**: Verificar que la columna `investment_range` exista en Supabase antes de intentar actualizarla.
2. **Descarga de Datos (Paginación)**: Bajar todos los registros disponibles iterando con `.range()` para evadir el límite de PostgREST.
3. **Data Scrubbing**:
   - `contractor_name` / `owner_name`: Aplicar `.title()` de Python.
   - `address` / `city`: Remover caracteres no alfanuméricos irregulares (conservar guiones y números).
4. **Auditoría de ZIP**:
   - Buscar regex `\b\d{5}\b` en la dirección o ciudad si `zip_code` es nulo o vacío.
5. **Deduplicación**:
   - Crear una llave única concatenando `address` + `project_type` (normalizados).
   - Mantener el registro más reciente (o el primero que se encuentre) y guardar los IDs de los demás para borrarlos con una operación `DELETE`.
6. **Segmentación por Valor (`investment_range`)**:
   - `< $15k`: "Micro-proyecto"
   - `$15k - $50k`: "Remodelación Estándar"
   - `$50k - $250k`: "Alto Valor"
   - `> $250k`: "Comercial / Lujo"
7. **Sincronización Batch**: Subir las actualizaciones y ejecutar los borrados en lotes de 500 para no saturar la red.

## Trampas Conocidas (Edge Cases)
- **Error "column does not exist"**: Si `investment_range` no está creada en la tabla, Supabase rechazará todo el batch. Es mandatorio pedir al usuario que cree la columna tipo `text` antes de procesar el step 6.
- **Límites de Supabase**: Nunca hacer `.update()` masivo en bucle, usar `.upsert()` con arrays o `.in_()` para deletes.
- **Valuaciones Nulas**: Tratar valuaciones `null` como `0`.
