-- Script para ejecutar en el SQL Editor de Supabase
-- Tabla para registrar la auditoría y generación de leads por corrida (Batch)

CREATE TABLE IF NOT EXISTS public.lead_audit_logs (
    id UUID DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    batch_id VARCHAR(255) NOT NULL,
    run_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    total_leads INTEGER NOT NULL DEFAULT 0,
    diamante_count INTEGER NOT NULL DEFAULT 0,
    oro_count INTEGER NOT NULL DEFAULT 0,
    plata_count INTEGER NOT NULL DEFAULT 0,
    total_revenue_potential NUMERIC(12, 2) NOT NULL DEFAULT 0,
    source_states VARCHAR(255),
    notes TEXT
);

-- Si deseas ver un reporte rápido de los ingresos proyectados:
-- SELECT batch_id, diamante_count, oro_count, plata_count, total_revenue_potential FROM lead_audit_logs ORDER BY run_date DESC;
