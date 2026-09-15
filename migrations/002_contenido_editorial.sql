BEGIN IMMEDIATE;

-- Amplía la biblioteca existente con los bloques editoriales que deben seguir
-- siendo editables y versionables junto al título y la descripción principal.
ALTER TABLE biblioteca_contenido ADD COLUMN descripcion_corta TEXT;
ALTER TABLE biblioteca_contenido ADD COLUMN caracteristicas_tecnicas TEXT;
ALTER TABLE biblioteca_contenido ADD COLUMN historia_dato_curioso TEXT;
ALTER TABLE biblioteca_contenido ADD COLUMN seo_title TEXT;
ALTER TABLE biblioteca_contenido ADD COLUMN meta_description TEXT;

-- Conserva la inmutabilidad de todas las partes de una versión aprobada.
DROP TRIGGER trg_biblioteca_contenido_aprobado_no_reescribir;
CREATE TRIGGER trg_biblioteca_contenido_aprobado_no_reescribir
BEFORE UPDATE ON biblioteca_contenido
WHEN OLD.estado = 'APROBADO'
  AND (
    NEW.producto_id IS NOT OLD.producto_id
    OR NEW.locale IS NOT OLD.locale
    OR NEW.version IS NOT OLD.version
    OR NEW.titulo_plantilla IS NOT OLD.titulo_plantilla
    OR NEW.descripcion_corta IS NOT OLD.descripcion_corta
    OR NEW.descripcion_plantilla_html IS NOT OLD.descripcion_plantilla_html
    OR NEW.caracteristicas_tecnicas IS NOT OLD.caracteristicas_tecnicas
    OR NEW.historia_dato_curioso IS NOT OLD.historia_dato_curioso
    OR NEW.seo_title IS NOT OLD.seo_title
    OR NEW.meta_description IS NOT OLD.meta_description
    OR NEW.generador IS NOT OLD.generador
    OR NEW.version_generador IS NOT OLD.version_generador
    OR NEW.hash_prompt IS NOT OLD.hash_prompt
    OR NEW.huella_origen IS NOT OLD.huella_origen
    OR NEW.aprobado_en_ms IS NOT OLD.aprobado_en_ms
    OR NEW.aprobado_por IS NOT OLD.aprobado_por
    OR NEW.creado_en_ms IS NOT OLD.creado_en_ms
    OR NEW.estado NOT IN ('APROBADO', 'REEMPLAZADO')
  )
BEGIN
  SELECT RAISE(ABORT, 'El contenido aprobado no puede reescribirse');
END;

COMMIT;
