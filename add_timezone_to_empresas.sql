-- Agregar columna timezone a tabla companies (anteriormente referida como empresas)
ALTER TABLE companies 
ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Santiago';

-- Actualizar companies existentes con timezone por defecto
UPDATE companies 
SET timezone = 'America/Santiago' 
WHERE timezone IS NULL OR timezone = '';
