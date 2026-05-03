# API PUBLICAS DE BUILDING PERMITS - GRATIS, SIN API KEY
# Fecha: 2026-05-03
# Fuente: Investigacion directa - endpoints probados y confirmados con llamadas HTTP reales

---

## LEYENDA
✅ = Confirmado funciona, devuelve datos reales
⚠️ = Funciona pero tiene limitaciones
❌ = No funciona / no tiene contractor info
🔍 = No investigado aun

---

## FASE 1: TEXAS

### Harris County (Houston) -- ❌ NO SIRVE PARA LEADHUNTER
- Tipo: ArcGIS REST FeatureServer
- Endpoint: services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/SF_BuildingPermits_SZ/FeatureServer/17
- **Problema**: ActivePermits_SZ es capa de geocodificacion, sin contractor info ni valuation
- Los datasets de Houston NO tienen contractor name/phone/valuation
- Alternativa: Buscar si Houston tiene un portal Socrata legacy
- **Veredicto**: No implementar

### Dallas County -- 🔍 NO INVESTIGADO
- Pendiente de investigar

### Tarrant County (Fort Worth) -- 🔍 NO INVESTIGADO
- Pendiente de investigar

### Bexar County (San Antonio) -- 🔍 NO INVESTIGADO
- Pendiente de investigar

### Travis County (Austin) -- ✅ CONFIRMADO, RECOMENDADO
- Tipo: Socrata / SODA API
- Endpoint: https://data.austintexas.gov/resource/3syk-w9eu.json
- Dataset: Issued Construction Permits
- **Campos**: permit_number, permittype, description, issue_date, total_job_valuation, contractor_company_name, contractor_full_name, contractor_phone, applicant_full_name
- **Tiene contractor name + phone DIRECTAMENTE**
- **Sin API key**
- **Datos actualizados diariamente** (2026 activo)
- **Prioridad: ALTA - IMPLEMENTAR YA**

---

## FASE 1: FLORIDA

### Hillsborough County (Tampa) -- ✅ YA IMPLEMENTADO
- Tipo: ArcGIS REST FeatureServer
- Endpoint: services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer/4
- Tiene: TYPE, ISSUED_DATE, ADDRESS, CITY, Value, DESCRIPTION, STATUS
- Contractor: extraible desde DESCRIPTION con regex (GC: NOMBRE)
- Sin API key
- **Ya funciona en produccion**

### Miami-Dade County -- ✅ CONFIRMADO, RECOMENDADO
- Tipo: ArcGIS REST FeatureServer
- Endpoint: https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0
- **Campos CONFIRMADOS**: PermitNumber, PermitType (BLDG/MECH/PLUM/etc), PropertyAddress, City, State, EstimatedValue, OwnerName, ContractorName, **ContractorPhone**, ContractorAddress, PermitIssuedDate, ApplicationDate, SquareFootage
- **Tiene contractor name + phone DIRECTAMENTE** (ej: MPP GROUP CORP -> (786)443-9590)
- **Sin API key**
- **Datos actualizados** (modificado 2026-05-02)
- **Prioridad: ALTA - MISMO PATRON QUE HILLSBOROUGH**

### Orange County (Orlando) -- ✅ CONFIRMADO, RECOMENDADO
- Tipo: Socrata / SODA API
- Endpoint: https://data.cityoforlando.net/resource/ryhf-m453.json (NUEVO ID, datos 2010-presente)
- Endpoint alternativo: https://data.cityoforlando.net/resource/75b6-g9zg.json (solo 1000 permits, hasta 2022)
- **Campos**: permit_number, application_type, permit_address, property_owner_name, contractor_name, contractor_phone_number, estimated_cost, issue_permit_date, processed_date, application_status
- **Tiene contractor name + phone DIRECTAMENTE**
- **Sin API key**
- **Datos hasta Mayo 2026** (recientes)
- **Prioridad: ALTA - MISMO PATRON QUE CHICAGO**

---

## FASE 1: CAROLINA DEL NORTE

### Mecklenburg County (Charlotte) -- ❌ NO HAY API PUBLICA
- data.mecknc.gov requiere login
- data.charlottenc.gov tiene ArcGIS Hub pero no encontre building permits dataset
- **Veredicto**: No implementar por ahora

### Wake County (Raleigh) -- 🔍 NO INVESTIGADO

---

## FASE 2: GEORGIA

### Fulton County (Atlanta) -- 🔍 NO CONFIRMADO
- Intentar: data.fultoncountyga.gov (no encontre building permits)
- Alternativa: Accela ACA scraping (existente, no funciona por CAPTCHA)

### Gwinnett County -- 🔍 NO CONFIRMADO
- Intentar: data.gwinnettcounty.com

---

## FASE 2: COLORADO

### Denver County -- 🔍 PARCIAL
- data.denvergov.org existe pero bloquea acceso automatico
- Probar: ArcGIS REST directo en gis.denvergov.org

### El Paso County (Colorado Springs) -- 🔍 NO INVESTIGADO

---

## OTROS ESTADOS CONFIRMADOS (no prioritarios ahora)

### Illinois
- Chicago: Socrata yd8-5enu (YA IMPLEMENTADO, endpoint actualizado)

### California
- San Francisco: Socrata i98e-djp9 (sin contractor phone)
- Los Angeles: Socrata 6q2s-9pnn (datos 2015+)

### Nueva York
- NYC: Socrata ipu4-2q9a (TIENE contractor phone)

### Washington
- Seattle: Socrata 76t5-zqzr (sin contractor phone)

---

## RESUMEN: LO QUE DEBES IMPLEMENTAR AHORA

| # | Condado | Tipo API | Tiene contractor? | Esfuerzo |
|---|---------|----------|-------------------|----------|
| 1 | **Miami-Dade FL** | ArcGIS FeatureServer | ✅ Nombre + Telefono | 2h (mismo patron Hillsborough) |
| 2 | **Orange FL (Orlando)** | Socrata | ✅ Nombre + Telefono | 1h (mismo patron Chicago) |
| 3 | **Austin TX** | Socrata | ✅ Nombre + Telefono | 1h (mismo patron Chicago) |

### Y ARREGLAR:
4. Chicago actualizar endpoint ID (5 min)

### Y CORRER:
5. Chicago + Austin + Orlando para llenar la BD con leads frescos de 3 estados

---

## COMO IMPLEMENTAR CADA TIPO DE API

### Patron ArcGIS FeatureServer (Miami-Dade, Hillsborough)
```javascript
const url = `${baseUrl}/query`;
const params = {
  where: `PermitType IN ('BLDG','MECH','ELEC','PLUM','ROOF') AND PermitIssuedDate >= date '${dateStr}'`,
  outFields: 'PermitNumber,PermitType,PermitIssuedDate,PropertyAddress,City,EstimatedValue,OwnerName,ContractorName,ContractorPhone',
  resultRecordCount: 1000,
  orderByFields: 'PermitIssuedDate DESC',
  f: 'json',
};
// POST al endpoint
```

### Patron Socrata SODA (Orlando, Austin, Chicago)
```javascript
const url = `${baseUrl}?$limit=1000&$where=issue_date >= '${dateStr}'&$order=issue_date DESC`;
// GET al endpoint
```
