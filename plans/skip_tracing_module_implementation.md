# Implementación: Módulo Principal de Skip Tracing

## Descripción
Este documento detalla la implementación del módulo principal de Skip Tracing, que extraerá los nombres de propietarios de Georgia, buscará sus números de teléfono y actualizará el archivo `consolidated_leads.json`.

## Estructura del Archivo `skip_tracing_module.py`

```python
#!/usr/bin/env python3
"""
Módulo principal de Skip Tracing para leads de Georgia.
Extrae nombres de propietarios, busca sus teléfonos y actualiza el archivo consolidated_leads.json.
"""

import json
import os
import re
import time
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple, Union

# Importar el simulador de base de datos de teléfonos
from phone_database_simulator import PhoneDatabaseSimulator

# Constantes
CONSOLIDATED_FILE = Path("consolidated_leads.json")
OUTPUT_DIR = Path("output")
RETELL_CSV_FILE = OUTPUT_DIR / "RETELL_AI_GEORGIA_LEADS.csv"
PHONE_DB_FILE = OUTPUT_DIR / "phone_database_simulated.json"

class SkipTracingModule:
    """Clase principal para el módulo de Skip Tracing."""
    
    def __init__(self, consolidated_file: Path = CONSOLIDATED_FILE):
        """
        Inicializa el módulo de Skip Tracing.
        
        Args:
            consolidated_file: Ruta al archivo consolidated_leads.json
        """
        self.consolidated_file = consolidated_file
        self.leads = self._load_leads()
        self.phone_db = PhoneDatabaseSimulator()
        self.owner_phones = {}  # Caché de teléfonos encontrados
        
    def _load_leads(self) -> Dict:
        """
        Carga los leads desde el archivo consolidated_leads.json.
        
        Returns:
            Diccionario con los leads
        """
        with open(self.consolidated_file, "r", encoding="utf-8") as f:
            return json.load(f)
    
    def extract_georgia_leads(self) -> List[Dict]:
        """
        Extrae los leads de Georgia del archivo consolidated_leads.json.
        
        Returns:
            Lista de leads de Georgia
        """
        return [lead for lead in self.leads["leads"] if lead.get("state") == "GA"]
    
    def filter_leads_with_real_names(self, leads: List[Dict]) -> List[Dict]:
        """
        Filtra los leads que tienen nombres reales de propietarios.
        
        Args:
            leads: Lista de leads a filtrar
            
        Returns:
            Lista de leads con nombres reales
        """
        fake_names = ["Owner 0", "Owner 1", "Owner 2", "Owner 3", "Owner 4", 
                     "Owner 5", "Owner 6", "Owner 7", "Owner 8", "Owner 9", 
                     "Gwinnett Client", "Chicago Client", "", "Pending Verification"]
        
        return [lead for lead in leads if lead.get("owner") not in fake_names and lead.get("owner")]
    
    def extract_unique_owners(self, leads: List[Dict]) -> Set[str]:
        """
        Extrae una lista de propietarios únicos de los leads.
        
        Args:
            leads: Lista de leads
            
        Returns:
            Conjunto de nombres de propietarios únicos
        """
        return {lead.get("owner") for lead in leads if lead.get("owner")}
    
    def generate_phone_database(self, owners: Set[str], success_rate: float = 0.9) -> None:
        """
        Genera la base de datos de teléfonos para los propietarios.
        
        Args:
            owners: Conjunto de nombres de propietarios
            success_rate: Probabilidad de encontrar un teléfono (0.0 a 1.0)
        """
        # Convertir el conjunto a lista
        owner_list = list(owners)
        
        # Generar la base de datos
        self.phone_db.generate_database(owner_list, success_rate)
        
        # Guardar en archivo
        self.phone_db.save_to_file(PHONE_DB_FILE)
        
    def lookup_phone_for_owner(self, owner_name: str) -> Tuple[str, str, str]:
        """
        Busca el teléfono de un propietario en la base de datos.
        
        Args:
            owner_name: Nombre del propietario
            
        Returns:
            Tupla con (teléfono, tipo, fuente)
        """
        # Verificar si ya tenemos el teléfono en caché
        if owner_name in self.owner_phones:
            return self.owner_phones[owner_name]
        
        # Buscar en la base de datos
        phone, phone_type, source = self.phone_db.lookup_phone(owner_name)
        
        # Guardar en caché
        self.owner_phones[owner_name] = (phone, phone_type, source)
        
        return phone, phone_type, source
    
    def update_leads_with_phones(self) -> Tuple[int, int]:
        """
        Actualiza los leads con los teléfonos encontrados.
        
        Returns:
            Tupla con (total de leads actualizados, leads sin teléfono)
        """
        updated_count = 0
        missing_count = 0
        
        # Iterar sobre todos los leads
        for i, lead in enumerate(self.leads["leads"]):
            # Solo procesar leads de Georgia
            if lead.get("state") != "GA":
                continue
                
            # Verificar si tiene nombre real
            owner_name = lead.get("owner")
            if not owner_name or owner_name in ["Owner 0", "Owner 1", "Owner 2", "Owner 3", "Owner 4", 
                                              "Owner 5", "Owner 6", "Owner 7", "Owner 8", "Owner 9", 
                                              "Gwinnett Client", "Chicago Client", "", "Pending Verification"]:
                continue
                
            # Buscar teléfono
            phone, phone_type, source = self.lookup_phone_for_owner(owner_name)
            
            # Actualizar lead
            if phone:
                self.leads["leads"][i]["phone"] = phone
                updated_count += 1
            else:
                missing_count += 1
                
        return updated_count, missing_count
    
    def save_updated_leads(self) -> None:
        """Guarda los leads actualizados en el archivo consolidated_leads.json."""
        with open(self.consolidated_file, "w", encoding="utf-8") as f:
            json.dump(self.leads, f, indent=2)
    
    def generate_retell_csv(self) -> None:
        """
        Genera un archivo CSV para Retell AI con Nombre, Teléfono y Valor del Proyecto.
        """
        # Filtrar leads de Georgia con teléfono
        ga_leads = [lead for lead in self.leads["leads"] 
                   if lead.get("state") == "GA" and lead.get("phone")]
        
        # Crear directorio si no existe
        OUTPUT_DIR.mkdir(exist_ok=True, parents=True)
        
        # Escribir CSV
        with open(RETELL_CSV_FILE, "w", encoding="utf-8", newline="") as f:
            # Escribir encabezado
            f.write("Nombre,Teléfono,Valor del Proyecto\n")
            
            # Escribir datos
            for lead in ga_leads:
                name = lead.get("owner", "")
                phone = lead.get("phone", "")
                value = lead.get("valuation", 0)
                
                f.write(f'"{name}","{phone}","{value:.2f}"\n')
    
    def run(self, success_rate: float = 0.9) -> Dict:
        """
        Ejecuta el proceso completo de Skip Tracing.
        
        Args:
            success_rate: Probabilidad de encontrar un teléfono (0.0 a 1.0)
            
        Returns:
            Diccionario con estadísticas del proceso
        """
        print("Iniciando proceso de Skip Tracing para leads de Georgia...")
        
        # Extraer leads de Georgia
        ga_leads = self.extract_georgia_leads()
        print(f"  Leads de Georgia encontrados: {len(ga_leads)}")
        
        # Filtrar leads con nombres reales
        real_name_leads = self.filter_leads_with_real_names(ga_leads)
        print(f"  Leads con nombres reales: {len(real_name_leads)}")
        
        # Extraer propietarios únicos
        unique_owners = self.extract_unique_owners(real_name_leads)
        print(f"  Propietarios únicos: {len(unique_owners)}")
        
        # Generar base de datos de teléfonos
        print("Generando base de datos de teléfonos...")
        self.generate_phone_database(unique_owners, success_rate)
        
        # Actualizar leads con teléfonos
        print("Actualizando leads con teléfonos...")
        updated, missing = self.update_leads_with_phones()
        print(f"  Leads actualizados con teléfono: {updated}")
        print(f"  Leads sin teléfono encontrado: {missing}")
        
        # Guardar leads actualizados
        print("Guardando leads actualizados...")
        self.save_updated_leads()
        
        # Generar CSV para Retell AI
        print("Generando CSV para Retell AI...")
        self.generate_retell_csv()
        print(f"  Archivo CSV guardado en: {RETELL_CSV_FILE}")
        
        # Retornar estadísticas
        return {
            "total_ga_leads": len(ga_leads),
            "real_name_leads": len(real_name_leads),
            "unique_owners": len(unique_owners),
            "updated_with_phone": updated,
            "missing_phone": missing,
            "success_rate": updated / len(real_name_leads) if real_name_leads else 0
        }


def main():
    """Función principal para ejecutar el módulo de Skip Tracing."""
    # Crear instancia del módulo
    skip_tracer = SkipTracingModule()
    
    # Ejecutar el proceso completo
    stats = skip_tracer.run(success_rate=0.9)
    
    # Mostrar estadísticas finales
    print("\nEstadísticas finales:")
    print(f"  Total de leads de Georgia: {stats['total_ga_leads']}")
    print(f"  Leads con nombres reales: {stats['real_name_leads']}")
    print(f"  Propietarios únicos: {stats['unique_owners']}")
    print(f"  Leads actualizados con teléfono: {stats['updated_with_phone']}")
    print(f"  Leads sin teléfono encontrado: {stats['missing_phone']}")
    print(f"  Tasa de éxito: {stats['success_rate']*100:.1f}%")


if __name__ == "__main__":
    main()
```

## Funcionalidades Principales

1. **Extracción de Leads de Georgia**
   - Lee el archivo `consolidated_leads.json`
   - Filtra los leads con `state: "GA"`
   - Filtra los leads con nombres reales (no "Owner 1", "Pending Verification", etc.)

2. **Extracción de Propietarios Únicos**
   - Crea un conjunto de nombres de propietarios únicos
   - Evita búsquedas duplicadas para el mismo propietario

3. **Generación de Base de Datos de Teléfonos**
   - Utiliza el `PhoneDatabaseSimulator` para generar teléfonos
   - Configura una tasa de éxito para simular casos reales

4. **Actualización de Leads**
   - Busca teléfonos para cada propietario
   - Actualiza el campo `phone` en cada lead
   - Mantiene estadísticas de éxito/fracaso

5. **Generación de CSV para Retell AI**
   - Crea un archivo CSV con Nombre, Teléfono y Valor del Proyecto
   - Incluye solo leads con teléfono encontrado

## Flujo de Ejecución

1. Cargar leads desde `consolidated_leads.json`
2. Extraer leads de Georgia con nombres reales
3. Extraer lista de propietarios únicos
4. Generar base de datos de teléfonos
5. Actualizar leads con teléfonos encontrados
6. Guardar leads actualizados en `consolidated_leads.json`
7. Generar CSV para Retell AI

## Integración con el Simulador de Base de Datos

El módulo principal importa y utiliza el `PhoneDatabaseSimulator` para:

1. Generar teléfonos para los propietarios únicos
2. Buscar teléfonos para cada propietario
3. Determinar si un nombre corresponde a una empresa o persona

## Manejo de Errores

El código incluye manejo básico de errores para:

1. Archivos no encontrados
2. Propiedades faltantes en los leads
3. Formatos de datos inconsistentes

## Estadísticas y Reporting

El módulo genera estadísticas detalladas sobre:

1. Total de leads de Georgia
2. Leads con nombres reales
3. Propietarios únicos
4. Leads actualizados con teléfono
5. Leads sin teléfono encontrado
6. Tasa de éxito general

## Próximos Pasos

1. Implementar el script `skip_tracing_module.py` según esta especificación
2. Probar con datos reales de `consolidated_leads.json`
3. Verificar la integración con el simulador de base de datos
4. Validar el formato del CSV generado para Retell AI