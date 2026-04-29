# SOP: Expansión de Mercado - Georgia Leads

## Objetivo
Configurar el pipeline de extracción y procesamiento para el nuevo mercado de Georgia (GA), enfocándose en áreas de alto crecimiento y tipos de permisos críticos.

## Áreas de Operación (Georgia)
- Atlanta
- Marietta
- Alpharetta
- Lawrenceville
- Decatur

## Categorías de Leads (Keywords)
1. **Roofing**: Reemplazos y reparaciones de techo.
2. **Interior Remodel**: Renovaciones de cocinas, baños y sótanos.
3. **New Construction**: Nuevas viviendas y adiciones estructurales.
4. **Low Voltage**: Instalaciones de seguridad, redes y automatización (Alto valor para partners tecnológicos).

## Configuración de Extracción (Apify)
- **Filtro Temporal**: Solo registros emitidos en las últimas **48 horas**.
- **Input**: Lista de URLs de búsqueda generadas dinámicamente o parámetros de búsqueda directa para el actor de Apify.
- **Output Requerido**: `leads_georgia_raw.json`.

## Lógica de Procesamiento (Gemini / Processor)
- Al ser un mercado nuevo, se debe aplicar un scoring inicial base de 100 puntos.
- Los leads de 'New Construction' en Alpharetta deben recibir un boost de +50 puntos por ser zona de alto ticket.

## Restricciones y Casos Borde
- **TimeZone**: Georgia usa EST. Asegurar que el filtro de "48 horas" use `dayjs().subtract(48, 'hour')`.
- **Formato de Dirección**: Validar que el estado 'GA' esté presente en el procesamiento posterior.
- **Nomenclatura**: El archivo de salida DEBE ser estrictamente `leads_georgia_raw.json` para mantener compatibilidad con el pipeline de Gemini.
