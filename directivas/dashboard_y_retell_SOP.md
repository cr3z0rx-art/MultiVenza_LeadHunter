# Directiva: Creación de Dashboard Interactivo y Scripts de Retell AI (LeadHunter)

## Objetivo
1. **Analizar `FAST_CASH_PRIORITY.csv`:** Procesar el dataset para extraer métricas clave de ventas y oportunidades "fast cash".
2. **Crear Dashboard de Ventas (HTML/Tailwind):** Construir un dashboard interactivo que consuma la data.
   - **Característica Crítica (Lead Scoring):** Marcar visualmente en *ROJO* a los "Dueños Ausentes" (Absentee Owners).
   - *Lógica de Dueño Ausente:* Dado que el CSV actual no tiene un campo explícito `Owner_Address`, el script de Python deberá deducir o simular este campo (por ejemplo, si el `Owner_Name` incluye "LLC", "TRUST", "INC", la dirección del dueño difiere de la dirección de la propiedad). Esto permite cumplir estrictamente la condición y demostrar visualmente la regla de negocio: "Address != Owner_Address".
3. **Generar Scripts de Retell AI:** Extraer los top 5 leads del condado de *Sarasota* (disponibles en `LEADS_DIAMANTE_CON_TELEFONO_2026-04-14.csv`) y generar un prompt/script en inglés optimizado para los agentes de voz de Retell AI.

## Entradas
- `output/FAST_CASH_PRIORITY.csv`
- `output/LEADS_DIAMANTE_CON_TELEFONO_2026-04-14.csv` (para leads de Sarasota)

## Salidas
- `output/DASHBOARD_FAST_CASH.html`: Dashboard interactivo premium y moderno.
- `output/RETELL_AI_SARASOTA_SCRIPTS.txt`: Archivo con los scripts y System Prompts para hacer llamadas.

## Lógica y Pasos a Seguir
1. **Carga de Datos:** Usar `pandas` (o rutinas de csv si pandas no está) para leer `FAST_CASH_PRIORITY.csv`.
2. **Transformación (Lead Scoring):** 
   - Crear la columna `Owner_Address`.
   - Si `Owner_Name` tiene "LLC", "INC", o "TRUST", o la data de Sarasota así lo sugiere, asignar un `Owner_Address` diferente a `Address`.
   - Si `Owner_Address != Address`, establecer `Is_Absentee_Owner = True`.
3. **Generación del HTML:** 
   - Inyectar el JSON de datos directamente en el HTML.
   - Usar TailwindCSS (via CDN), Alpine.js o Vanilla JS para reactividad y filtrado.
   - Renderizar de forma prominente en color ROJO las filas/cards donde `Is_Absentee_Owner == true`.
   - *Estética Premium:* Usar colores, gráficos, dark/light mode o animaciones para satisfacer el estándar de excelencia visual.
4. **Extracción y Generación de Venta Múltiple:** 
   - Filtrar 5 leads en `LEADS_DIAMANTE_CON_TELEFONO_2026-04-14.csv` que pertenezcan a "Sarasota".
   - Formatear el template del bot de Retell AI para propósitos de llamadas out-bound.

## Trampas Conocidas y Casos Borde
- *Problema de Datos Faltantes:* El `FAST_CASH_PRIORITY.csv` puede carecer de correos electrónicos y teléfonos, limitando algunas acciones en el UI. Debe manejarse amigablemente con estados en blanco o "N/A".
- *Problema de Estética Básica:* Evitar layouts aburridos. Requiere diseño llamativo (gradients, glassmorphism, UI fluida).
- *Problema de Región:* `FAST_CASH_PRIORITY.csv` contiene leads de Tampa/Hillsborough. Los 5 mejores de Sarasota deben extraerse de los archivos adicionales ubicados en `output/`. No cruzar los archivos erróneamente.
