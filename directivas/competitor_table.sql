-- Script para ejecutar en el SQL Editor de Supabase
-- Tabla para inteligencia de mercado: análisis de competidores

CREATE TABLE IF NOT EXISTS public.competitor_analysis (
    id UUID DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    batch_id VARCHAR(255) NOT NULL,
    permit_number VARCHAR(255) UNIQUE NOT NULL,
    state VARCHAR(50) NOT NULL,
    county VARCHAR(255),
    city VARCHAR(255),
    contractor_name VARCHAR(255) NOT NULL,
    project_type VARCHAR(255),
    valuation NUMERIC(12, 2) NOT NULL DEFAULT 0,
    permit_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices recomendados para acelerar las consultas de Market Insights
CREATE INDEX IF NOT EXISTS idx_comp_analysis_county ON competitor_analysis(county);
CREATE INDEX IF NOT EXISTS idx_comp_analysis_contractor ON competitor_analysis(contractor_name);
CREATE INDEX IF NOT EXISTS idx_comp_analysis_date ON competitor_analysis(permit_date);
