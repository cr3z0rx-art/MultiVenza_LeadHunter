#!/usr/bin/env python3
"""
Simulador de base de datos de teléfonos para Skip Tracing.
Genera datos realistas de teléfonos para propietarios de Georgia.
"""

import json
import random
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

# Constantes
OUTPUT_DIR = Path("output")
PHONE_DB_FILE = OUTPUT_DIR / "phone_database_simulated.json"

# Prefijos de área de Georgia
GA_AREA_CODES = ["404", "470", "478", "678", "706", "762", "770", "912"]

# Fuentes de datos para personas
PERSON_SOURCES = ["property_records", "white_pages", "linkedin", "voter_records", "social_media"]

# Fuentes de datos para empresas
BUSINESS_SOURCES = ["secretary_of_state", "yellow_pages", "google_business", "corporate_website", "chamber_of_commerce"]

# Tipos de teléfonos para personas
PERSON_PHONE_TYPES = ["mobile", "home", "work"]

# Tipos de teléfonos para empresas
BUSINESS_PHONE_TYPES = ["office", "sales", "customer_service", "main"]

class PhoneDatabaseSimulator:
    """Clase para simular una base de datos de teléfonos."""
    
    def __init__(self, seed: int = 42):
        """
        Inicializa el simulador con una semilla para reproducibilidad.
        
        Args:
            seed: Semilla para el generador de números aleatorios
        """
        random.seed(seed)
        self.db = {"personas": {}, "empresas": {}}
        
    def is_business(self, name: str) -> bool:
        """
        Determina si un nombre corresponde a una empresa o a una persona.
        
        Args:
            name: Nombre a analizar
            
        Returns:
            True si es empresa, False si es persona
        """
        business_indicators = [
            "LLC", "Inc", "Corp", "Group", "Partners", "Holdings", 
            "Developers", "Construction", "Estates", "Renovations", 
            "Homes", "Services", "Company", "Co.", "Associates"
        ]
        
        # Verificar si contiene indicadores de empresa
        for indicator in business_indicators:
            if indicator.lower() in name.lower():
                return True
        
        # Verificar formato de nombre de persona (Nombre Apellido)
        name_parts = name.split()
        if len(name_parts) == 2 and all(part[0].isupper() for part in name_parts):
            return False
            
        # Por defecto, si no estamos seguros, asumimos que es una empresa
        return len(name_parts) > 2
    
    def generate_phone(self, is_business: bool) -> Dict[str, str]:
        """
        Genera un número de teléfono aleatorio con metadatos.
        
        Args:
            is_business: True si es para una empresa, False si es para una persona
            
        Returns:
            Diccionario con teléfono, tipo y fuente
        """
        # Generar número de teléfono con formato de Georgia
        area_code = random.choice(GA_AREA_CODES)
        prefix = random.randint(200, 999)
        suffix = random.randint(1000, 9999)
        phone = f"{area_code}-{prefix}-{suffix}"
        
        # Seleccionar tipo y fuente según sea empresa o persona
        if is_business:
            phone_type = random.choice(BUSINESS_PHONE_TYPES)
            source = random.choice(BUSINESS_SOURCES)
        else:
            phone_type = random.choice(PERSON_PHONE_TYPES)
            source = random.choice(PERSON_SOURCES)
            
        return {
            "phone": phone,
            "type": phone_type,
            "source": source
        }
    
    def add_owner(self, name: str, success_rate: float = 0.9) -> None:
        """
        Añade un propietario a la base de datos con una probabilidad de éxito.
        
        Args:
            name: Nombre del propietario
            success_rate: Probabilidad de encontrar un teléfono (0.0 a 1.0)
        """
        # Determinar si es empresa o persona
        is_business = self.is_business(name)
        category = "empresas" if is_business else "personas"
        
        # Simular éxito/fracaso en la búsqueda
        if random.random() < success_rate:
            self.db[category][name] = self.generate_phone(is_business)
        else:
            # No se encontró teléfono
            self.db[category][name] = {
                "phone": "",
                "type": "unknown",
                "source": "not_found"
            }
    
    def generate_database(self, owners: List[str], success_rate: float = 0.9) -> None:
        """
        Genera la base de datos completa para una lista de propietarios.
        
        Args:
            owners: Lista de nombres de propietarios
            success_rate: Probabilidad de encontrar un teléfono (0.0 a 1.0)
        """
        for owner in owners:
            self.add_owner(owner, success_rate)
    
    def save_to_file(self, file_path: Optional[Path] = None) -> Path:
        """
        Guarda la base de datos en un archivo JSON.
        
        Args:
            file_path: Ruta del archivo (opcional)
            
        Returns:
            Ruta del archivo guardado
        """
        if file_path is None:
            file_path = PHONE_DB_FILE
            
        # Asegurar que el directorio existe
        file_path.parent.mkdir(exist_ok=True, parents=True)
        
        # Guardar en formato JSON
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(self.db, f, indent=2, ensure_ascii=False)
            
        return file_path
    
    @classmethod
    def load_from_file(cls, file_path: Optional[Path] = None) -> Dict:
        """
        Carga la base de datos desde un archivo JSON.
        
        Args:
            file_path: Ruta del archivo (opcional)
            
        Returns:
            Diccionario con la base de datos
        """
        if file_path is None:
            file_path = PHONE_DB_FILE
            
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    
    def lookup_phone(self, name: str) -> Tuple[str, str, str]:
        """
        Busca un teléfono en la base de datos.
        
        Args:
            name: Nombre del propietario
            
        Returns:
            Tupla con (teléfono, tipo, fuente)
        """
        # Determinar categoría
        is_business = self.is_business(name)
        category = "empresas" if is_business else "personas"
        
        # Buscar en la base de datos
        if name in self.db[category]:
            entry = self.db[category][name]
            return entry["phone"], entry["type"], entry["source"]
        
        # No encontrado
        return "", "unknown", "not_found"


def main():
    """Función principal para generar la base de datos simulada."""
    # Lista de propietarios de ejemplo (se reemplazará con datos reales)
    sample_owners = [
        "Atlanta Development LLC",
        "Peachtree Construction Group",
        "Georgia Home Builders Inc.",
        "Fulton Residential Partners",
        "Gwinnett Property Holdings",
        "Buckhead Estates LLC",
        "Midtown Renovations Co.",
        "Southern Homes of Georgia",
        "Atlantic Construction Services",
        "Piedmont Developers Group",
        "Robert Johnson",
        "Maria Garcia",
        "James Williams",
        "David Smith",
        "Jennifer Martinez",
        "Michael Brown",
        "Sarah Wilson",
        "Thomas Anderson",
        "Elizabeth Taylor",
        "Richard Davis"
    ]
    
    # Crear y generar la base de datos
    simulator = PhoneDatabaseSimulator(seed=42)
    simulator.generate_database(sample_owners, success_rate=0.9)
    
    # Guardar en archivo
    file_path = simulator.save_to_file()
    print(f"Base de datos simulada guardada en: {file_path}")
    
    # Mostrar estadísticas
    personas = len(simulator.db["personas"])
    empresas = len(simulator.db["empresas"])
    total = personas + empresas
    
    print(f"\nEstadísticas:")
    print(f"  Total de propietarios: {total}")
    print(f"  Personas: {personas} ({personas/total*100:.1f}%)")
    print(f"  Empresas: {empresas} ({empresas/total*100:.1f}%)")
    
    # Mostrar ejemplos
    print("\nEjemplos de teléfonos generados:")
    
    # Ejemplo de persona
    if simulator.db["personas"]:
        name = list(simulator.db["personas"].keys())[0]
        entry = simulator.db["personas"][name]
        print(f"  Persona: {name}")
        print(f"    Teléfono: {entry['phone']}")
        print(f"    Tipo: {entry['type']}")
        print(f"    Fuente: {entry['source']}")
    
    # Ejemplo de empresa
    if simulator.db["empresas"]:
        name = list(simulator.db["empresas"].keys())[0]
        entry = simulator.db["empresas"][name]
        print(f"  Empresa: {name}")
        print(f"    Teléfono: {entry['phone']}")
        print(f"    Tipo: {entry['type']}")
        print(f"    Fuente: {entry['source']}")


if __name__ == "__main__":
    main()