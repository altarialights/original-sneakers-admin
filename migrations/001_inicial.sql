-- Esquema inicial aprobado para SQLite/libSQL/Turso.
-- No contiene datos reales ni realiza conexiones externas.

PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

-- Catalogo canonico: un producto representa modelo + colorway/referencia.
CREATE TABLE productos (
  id TEXT NOT NULL,
  titulo_canonico TEXT NOT NULL,
  marca_original TEXT,
  marca_normalizada TEXT,
  nombre_modelo TEXT,
  colorway_original TEXT,
  colorway_normalizado TEXT,
  referencia_original TEXT,
  referencia_normalizada TEXT,
  clave_normalizada TEXT,
  version_normalizacion INTEGER NOT NULL DEFAULT 1,
  tipo_producto TEXT,
  estado TEXT NOT NULL DEFAULT 'BORRADOR',
  estado_revision TEXT NOT NULL DEFAULT 'SIN_REVISAR',
  creado_en_ms INTEGER NOT NULL,
  actualizado_en_ms INTEGER NOT NULL,
  archivado_en_ms INTEGER,

  CONSTRAINT pk_productos PRIMARY KEY (id),
  CONSTRAINT ck_productos_id_uuidv7 CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
    AND substr(id, 24, 1) = '-'
    AND lower(id) = id
    AND id NOT GLOB '*[^0-9a-f-]*'
  ),
  CONSTRAINT ck_productos_titulo_no_vacio CHECK (length(trim(titulo_canonico)) > 0),
  CONSTRAINT ck_productos_version_normalizacion CHECK (version_normalizacion >= 1),
  CONSTRAINT ck_productos_tipo CHECK (
    tipo_producto IS NULL
    OR tipo_producto IN ('CALZADO', 'ROPA', 'ACCESORIO', 'OTRO')
  ),
  CONSTRAINT ck_productos_estado CHECK (estado IN ('BORRADOR', 'ACTIVO', 'ARCHIVADO')),
  CONSTRAINT ck_productos_estado_revision CHECK (
    estado_revision IN ('SIN_REVISAR', 'REQUIERE_REVISION', 'APROBADO', 'RECHAZADO')
  ),
  CONSTRAINT ck_productos_timestamps CHECK (
    creado_en_ms >= 0
    AND actualizado_en_ms >= creado_en_ms
    AND (archivado_en_ms IS NULL OR archivado_en_ms >= creado_en_ms)
  )
);

CREATE INDEX idx_productos_clave_normalizada
  ON productos (clave_normalizada);
CREATE INDEX idx_productos_referencia_normalizada
  ON productos (referencia_normalizada);
CREATE INDEX idx_productos_marca_modelo
  ON productos (marca_normalizada, nombre_modelo);
CREATE INDEX idx_productos_estado
  ON productos (estado, estado_revision);

-- Combinacion vendible de un producto. La talla pertenece aqui, no al producto.
CREATE TABLE variantes_producto (
  id TEXT NOT NULL,
  producto_id TEXT NOT NULL,
  titulo_variante TEXT,
  sku_original TEXT,
  sku_normalizado TEXT,
  barcode_original TEXT,
  barcode_normalizado TEXT,
  talla_original TEXT,
  sistema_talla TEXT,
  valor_talla_milesimas INTEGER,
  etiqueta_talla TEXT,
  longitud_pie_mm INTEGER,
  grupo_edad TEXT,
  publico_genero TEXT,
  firma_opciones_json TEXT NOT NULL,
  precio_centimos INTEGER NOT NULL,
  precio_comparacion_centimos INTEGER,
  moneda TEXT NOT NULL DEFAULT 'EUR',
  estado TEXT NOT NULL DEFAULT 'BORRADOR',
  requiere_revision INTEGER NOT NULL DEFAULT 0,
  creado_en_ms INTEGER NOT NULL,
  actualizado_en_ms INTEGER NOT NULL,
  archivado_en_ms INTEGER,

  CONSTRAINT pk_variantes_producto PRIMARY KEY (id),
  CONSTRAINT fk_variantes_producto_producto FOREIGN KEY (producto_id)
    REFERENCES productos (id) ON DELETE RESTRICT,
  CONSTRAINT uq_variantes_producto_firma UNIQUE (producto_id, firma_opciones_json),
  CONSTRAINT ck_variantes_producto_id_uuidv7 CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
    AND substr(id, 24, 1) = '-'
    AND lower(id) = id
    AND id NOT GLOB '*[^0-9a-f-]*'
  ),
  CONSTRAINT ck_variantes_producto_sistema_talla CHECK (
    sistema_talla IS NULL
    OR sistema_talla IN ('EU', 'US', 'UK', 'CM', 'ALFABETICO', 'EDAD', 'ALTURA', 'DESCONOCIDO')
  ),
  CONSTRAINT ck_variantes_producto_longitud_pie CHECK (
    longitud_pie_mm IS NULL OR longitud_pie_mm > 0
  ),
  CONSTRAINT ck_variantes_producto_valor_talla_milesimas CHECK (
    valor_talla_milesimas IS NULL OR valor_talla_milesimas > 0
  ),
  CONSTRAINT ck_variantes_producto_grupo_edad CHECK (
    grupo_edad IS NULL
    OR grupo_edad IN ('BEBE', 'INFANTIL', 'ADULTO', 'DESCONOCIDO')
  ),
  CONSTRAINT ck_variantes_producto_publico_genero CHECK (
    publico_genero IS NULL
    OR publico_genero IN ('UNISEX', 'HOMBRE', 'MUJER', 'NINO', 'NINA', 'DESCONOCIDO')
  ),
  CONSTRAINT ck_variantes_producto_firma_json CHECK (json_valid(firma_opciones_json)),
  CONSTRAINT ck_variantes_producto_precios CHECK (
    precio_centimos >= 0
    AND (precio_comparacion_centimos IS NULL OR precio_comparacion_centimos >= 0)
  ),
  CONSTRAINT ck_variantes_producto_moneda CHECK (
    length(moneda) = 3 AND moneda = upper(moneda)
  ),
  CONSTRAINT ck_variantes_producto_estado CHECK (
    estado IN ('BORRADOR', 'ACTIVO', 'ARCHIVADO')
  ),
  CONSTRAINT ck_variantes_producto_requiere_revision CHECK (requiere_revision IN (0, 1)),
  CONSTRAINT ck_variantes_producto_timestamps CHECK (
    creado_en_ms >= 0
    AND actualizado_en_ms >= creado_en_ms
    AND (archivado_en_ms IS NULL OR archivado_en_ms >= creado_en_ms)
  )
);

CREATE INDEX idx_variantes_producto_producto_estado
  ON variantes_producto (producto_id, estado);
CREATE INDEX idx_variantes_producto_sku_normalizado
  ON variantes_producto (sku_normalizado);
CREATE INDEX idx_variantes_producto_barcode_normalizado
  ON variantes_producto (barcode_normalizado);
CREATE INDEX idx_variantes_producto_talla
  ON variantes_producto (sistema_talla, valor_talla_milesimas, etiqueta_talla);
CREATE INDEX idx_variantes_producto_revision
  ON variantes_producto (requiere_revision)
  WHERE requiere_revision = 1;

-- Ubicaciones internas. Los IDs de locations externos se mapean en mapeos_canal.
CREATE TABLE ubicaciones_inventario (
  id TEXT NOT NULL,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  esta_activa INTEGER NOT NULL DEFAULT 1,
  creado_en_ms INTEGER NOT NULL,
  actualizado_en_ms INTEGER NOT NULL,

  CONSTRAINT pk_ubicaciones_inventario PRIMARY KEY (id),
  CONSTRAINT uq_ubicaciones_inventario_codigo UNIQUE (codigo),
  CONSTRAINT ck_ubicaciones_inventario_id_uuidv7 CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
    AND substr(id, 24, 1) = '-'
    AND lower(id) = id
    AND id NOT GLOB '*[^0-9a-f-]*'
  ),
  CONSTRAINT ck_ubicaciones_inventario_codigo_no_vacio CHECK (length(trim(codigo)) > 0),
  CONSTRAINT ck_ubicaciones_inventario_nombre_no_vacio CHECK (length(trim(nombre)) > 0),
  CONSTRAINT ck_ubicaciones_inventario_tipo CHECK (
    tipo IN ('ALMACEN', 'TIENDA', 'TRANSITO', 'VIRTUAL')
  ),
  CONSTRAINT ck_ubicaciones_inventario_esta_activa CHECK (esta_activa IN (0, 1)),
  CONSTRAINT ck_ubicaciones_inventario_timestamps CHECK (
    creado_en_ms >= 0 AND actualizado_en_ms >= creado_en_ms
  )
);

CREATE INDEX idx_ubicaciones_inventario_activas
  ON ubicaciones_inventario (esta_activa, tipo);

-- Saldo actual materializado por variante y ubicacion.
CREATE TABLE niveles_inventario (
  variante_id TEXT NOT NULL,
  ubicacion_id TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  actualizado_en_ms INTEGER NOT NULL,

  CONSTRAINT pk_niveles_inventario PRIMARY KEY (variante_id, ubicacion_id),
  CONSTRAINT fk_niveles_inventario_variante FOREIGN KEY (variante_id)
    REFERENCES variantes_producto (id) ON DELETE RESTRICT,
  CONSTRAINT fk_niveles_inventario_ubicacion FOREIGN KEY (ubicacion_id)
    REFERENCES ubicaciones_inventario (id) ON DELETE RESTRICT,
  CONSTRAINT ck_niveles_inventario_cantidad CHECK (cantidad >= 0),
  CONSTRAINT ck_niveles_inventario_version CHECK (version >= 0),
  CONSTRAINT ck_niveles_inventario_timestamp CHECK (actualizado_en_ms >= 0)
);

CREATE INDEX idx_niveles_inventario_ubicacion_cantidad
  ON niveles_inventario (ubicacion_id, cantidad);
CREATE INDEX idx_niveles_inventario_con_stock
  ON niveles_inventario (variante_id, ubicacion_id)
  WHERE cantidad > 0;

-- Canales externos e internos. Nunca se guardan secretos en configuracion_json.
CREATE TABLE canales (
  id TEXT NOT NULL,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  esta_activo INTEGER NOT NULL DEFAULT 1,
  configuracion_json TEXT,
  creado_en_ms INTEGER NOT NULL,
  actualizado_en_ms INTEGER NOT NULL,

  CONSTRAINT pk_canales PRIMARY KEY (id),
  CONSTRAINT uq_canales_codigo UNIQUE (codigo),
  CONSTRAINT ck_canales_id_uuidv7 CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
    AND substr(id, 24, 1) = '-'
    AND lower(id) = id
    AND id NOT GLOB '*[^0-9a-f-]*'
  ),
  CONSTRAINT ck_canales_codigo_no_vacio CHECK (length(trim(codigo)) > 0),
  CONSTRAINT ck_canales_nombre_no_vacio CHECK (length(trim(nombre)) > 0),
  CONSTRAINT ck_canales_tipo CHECK (
    tipo IN (
      'SHOPIFY', 'VINTED', 'WALLAPOP', 'MIRAVIA', 'TIKTOK',
      'INSTAGRAM', 'WHATSAPP', 'REVENDEDOR', 'TIENDA_FISICA'
    )
  ),
  CONSTRAINT ck_canales_esta_activo CHECK (esta_activo IN (0, 1)),
  CONSTRAINT ck_canales_configuracion_json CHECK (
    configuracion_json IS NULL OR json_valid(configuracion_json)
  ),
  CONSTRAINT ck_canales_timestamps CHECK (
    creado_en_ms >= 0 AND actualizado_en_ms >= creado_en_ms
  )
);

CREATE INDEX idx_canales_tipo_activo
  ON canales (tipo, esta_activo);

-- Mapping central de IDs externos. Un registro apunta exactamente a un target interno.
CREATE TABLE mapeos_canal (
  id TEXT NOT NULL,
  canal_id TEXT NOT NULL,
  tipo_entidad TEXT NOT NULL,
  producto_id TEXT,
  variante_id TEXT,
  ubicacion_id TEXT,
  mapeo_padre_id TEXT,
  id_externo TEXT NOT NULL,
  handle_externo TEXT,
  estado_publicacion TEXT,
  estado_sincronizacion TEXT NOT NULL DEFAULT 'PENDIENTE',
  actualizado_origen_en_ms INTEGER,
  sincronizado_en_ms INTEGER,
  ultimo_codigo_error TEXT,
  creado_en_ms INTEGER NOT NULL,
  actualizado_en_ms INTEGER NOT NULL,
  archivado_en_ms INTEGER,

  CONSTRAINT pk_mapeos_canal PRIMARY KEY (id),
  CONSTRAINT fk_mapeos_canal_canal FOREIGN KEY (canal_id)
    REFERENCES canales (id) ON DELETE RESTRICT,
  CONSTRAINT fk_mapeos_canal_producto FOREIGN KEY (producto_id)
    REFERENCES productos (id) ON DELETE RESTRICT,
  CONSTRAINT fk_mapeos_canal_variante FOREIGN KEY (variante_id)
    REFERENCES variantes_producto (id) ON DELETE RESTRICT,
  CONSTRAINT fk_mapeos_canal_ubicacion FOREIGN KEY (ubicacion_id)
    REFERENCES ubicaciones_inventario (id) ON DELETE RESTRICT,
  CONSTRAINT fk_mapeos_canal_padre FOREIGN KEY (mapeo_padre_id)
    REFERENCES mapeos_canal (id) ON DELETE RESTRICT,
  CONSTRAINT uq_mapeos_canal_id_externo UNIQUE (canal_id, tipo_entidad, id_externo),
  CONSTRAINT ck_mapeos_canal_id_uuidv7 CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
    AND substr(id, 24, 1) = '-'
    AND lower(id) = id
    AND id NOT GLOB '*[^0-9a-f-]*'
  ),
  CONSTRAINT ck_mapeos_canal_tipo_entidad CHECK (
    tipo_entidad IN ('PRODUCTO', 'VARIANTE', 'ITEM_INVENTARIO', 'UBICACION')
  ),
  CONSTRAINT ck_mapeos_canal_target CHECK (
    (tipo_entidad = 'PRODUCTO' AND producto_id IS NOT NULL AND variante_id IS NULL AND ubicacion_id IS NULL)
    OR
    (tipo_entidad IN ('VARIANTE', 'ITEM_INVENTARIO') AND producto_id IS NULL AND variante_id IS NOT NULL AND ubicacion_id IS NULL)
    OR
    (tipo_entidad = 'UBICACION' AND producto_id IS NULL AND variante_id IS NULL AND ubicacion_id IS NOT NULL)
  ),
  CONSTRAINT ck_mapeos_canal_id_externo_no_vacio CHECK (length(trim(id_externo)) > 0),
  CONSTRAINT ck_mapeos_canal_estado_publicacion CHECK (
    (
      tipo_entidad IN ('PRODUCTO', 'VARIANTE')
      AND estado_publicacion IS NOT NULL
      AND estado_publicacion IN ('BORRADOR', 'PUBLICADO', 'NO_PUBLICADO', 'ARCHIVADO', 'REQUIERE_ELIMINACION')
    )
    OR
    (
      tipo_entidad IN ('ITEM_INVENTARIO', 'UBICACION')
      AND estado_publicacion IS NULL
    )
  ),
  CONSTRAINT ck_mapeos_canal_estado_sincronizacion CHECK (
    estado_sincronizacion IN ('PENDIENTE', 'SINCRONIZADO', 'DESINCRONIZADO', 'ERROR', 'BLOQUEADO')
  ),
  CONSTRAINT ck_mapeos_canal_timestamps CHECK (
    creado_en_ms >= 0
    AND actualizado_en_ms >= creado_en_ms
    AND (actualizado_origen_en_ms IS NULL OR actualizado_origen_en_ms >= 0)
    AND (sincronizado_en_ms IS NULL OR sincronizado_en_ms >= 0)
    AND (archivado_en_ms IS NULL OR archivado_en_ms >= creado_en_ms)
  )
);

CREATE INDEX idx_mapeos_canal_producto
  ON mapeos_canal (canal_id, producto_id)
  WHERE tipo_entidad = 'PRODUCTO';
CREATE INDEX idx_mapeos_canal_variante
  ON mapeos_canal (canal_id, variante_id)
  WHERE tipo_entidad IN ('VARIANTE', 'ITEM_INVENTARIO');
CREATE INDEX idx_mapeos_canal_ubicacion
  ON mapeos_canal (canal_id, ubicacion_id)
  WHERE tipo_entidad = 'UBICACION';
CREATE INDEX idx_mapeos_canal_padre
  ON mapeos_canal (mapeo_padre_id)
  WHERE mapeo_padre_id IS NOT NULL;
CREATE INDEX idx_mapeos_canal_estado_sincronizacion
  ON mapeos_canal (canal_id, estado_sincronizacion);

-- Si se informa un padre, debe ser una publicacion PRODUCTO del mismo canal.
CREATE TRIGGER trg_mapeos_canal_validar_padre_insertar
BEFORE INSERT ON mapeos_canal
WHEN NEW.mapeo_padre_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM mapeos_canal AS padre
    WHERE padre.id = NEW.mapeo_padre_id
      AND padre.canal_id = NEW.canal_id
      AND padre.tipo_entidad = 'PRODUCTO'
  ) THEN RAISE(ABORT, 'La publicacion padre debe ser PRODUCTO del mismo canal') END;
END;

CREATE TRIGGER trg_mapeos_canal_validar_padre_actualizar
BEFORE UPDATE OF mapeo_padre_id, canal_id ON mapeos_canal
WHEN NEW.mapeo_padre_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM mapeos_canal AS padre
    WHERE padre.id = NEW.mapeo_padre_id
      AND padre.canal_id = NEW.canal_id
      AND padre.tipo_entidad = 'PRODUCTO'
  ) THEN RAISE(ABORT, 'La publicacion padre debe ser PRODUCTO del mismo canal') END;
END;

-- Ledger inmutable. El servicio futuro actualizara nivel y movimiento en una transaccion.
CREATE TABLE movimientos_inventario (
  id TEXT NOT NULL,
  variante_id TEXT NOT NULL,
  ubicacion_id TEXT NOT NULL,
  ubicacion_destino_id TEXT,
  tipo TEXT NOT NULL,
  delta INTEGER NOT NULL,
  saldo_posterior INTEGER NOT NULL,
  clave_idempotencia TEXT NOT NULL,
  origen TEXT NOT NULL,
  canal_origen_id TEXT,
  referencia_origen TEXT,
  coste_unitario_centimos INTEGER,
  moneda_coste TEXT,
  proveedor_original TEXT,
  referencia_factura TEXT,
  metadata_json TEXT,
  ocurrido_en_ms INTEGER NOT NULL,
  creado_en_ms INTEGER NOT NULL,
  creado_por TEXT NOT NULL,
  revierte_movimiento_id TEXT,

  CONSTRAINT pk_movimientos_inventario PRIMARY KEY (id),
  CONSTRAINT fk_movimientos_inventario_variante FOREIGN KEY (variante_id)
    REFERENCES variantes_producto (id) ON DELETE RESTRICT,
  CONSTRAINT fk_movimientos_inventario_ubicacion FOREIGN KEY (ubicacion_id)
    REFERENCES ubicaciones_inventario (id) ON DELETE RESTRICT,
  CONSTRAINT fk_movimientos_inventario_ubicacion_destino FOREIGN KEY (ubicacion_destino_id)
    REFERENCES ubicaciones_inventario (id) ON DELETE RESTRICT,
  CONSTRAINT fk_movimientos_inventario_canal FOREIGN KEY (canal_origen_id)
    REFERENCES canales (id) ON DELETE RESTRICT,
  CONSTRAINT fk_movimientos_inventario_reversion FOREIGN KEY (revierte_movimiento_id)
    REFERENCES movimientos_inventario (id) ON DELETE RESTRICT,
  CONSTRAINT uq_movimientos_inventario_clave_idempotencia UNIQUE (clave_idempotencia),
  CONSTRAINT ck_movimientos_inventario_id_uuidv7 CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
    AND substr(id, 24, 1) = '-'
    AND lower(id) = id
    AND id NOT GLOB '*[^0-9a-f-]*'
  ),
  CONSTRAINT ck_movimientos_inventario_tipo CHECK (
    tipo IN (
      'SALDO_INICIAL', 'COMPRA', 'VENTA', 'DEVOLUCION_ENTRADA', 'DEVOLUCION_SALIDA',
      'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'CORRECCION_SINCRONIZACION',
      'TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SALIDA', 'DANO'
    )
  ),
  CONSTRAINT ck_movimientos_inventario_delta CHECK (delta <> 0),
  CONSTRAINT ck_movimientos_inventario_signo CHECK (
    (tipo IN ('SALDO_INICIAL', 'COMPRA', 'DEVOLUCION_ENTRADA', 'AJUSTE_ENTRADA', 'TRANSFERENCIA_ENTRADA') AND delta > 0)
    OR
    (tipo IN ('VENTA', 'DEVOLUCION_SALIDA', 'AJUSTE_SALIDA', 'TRANSFERENCIA_SALIDA', 'DANO') AND delta < 0)
    OR
    (tipo = 'CORRECCION_SINCRONIZACION')
  ),
  CONSTRAINT ck_movimientos_inventario_saldo CHECK (saldo_posterior >= 0),
  CONSTRAINT ck_movimientos_inventario_clave_no_vacia CHECK (length(trim(clave_idempotencia)) > 0),
  CONSTRAINT ck_movimientos_inventario_origen CHECK (
    origen IN ('MANUAL', 'SISTEMA', 'IMPORTACION', 'CANAL')
  ),
  CONSTRAINT ck_movimientos_inventario_canal_origen CHECK (
    (origen = 'CANAL' AND canal_origen_id IS NOT NULL)
    OR (origen <> 'CANAL' AND canal_origen_id IS NULL)
  ),
  CONSTRAINT ck_movimientos_inventario_transferencia CHECK (
    (tipo IN ('TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SALIDA')
      AND ubicacion_destino_id IS NOT NULL
      AND ubicacion_destino_id <> ubicacion_id)
    OR
    (tipo NOT IN ('TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SALIDA')
      AND ubicacion_destino_id IS NULL)
  ),
  CONSTRAINT ck_movimientos_inventario_coste CHECK (
    (coste_unitario_centimos IS NULL AND moneda_coste IS NULL)
    OR
    (coste_unitario_centimos >= 0 AND length(moneda_coste) = 3 AND moneda_coste = upper(moneda_coste))
  ),
  CONSTRAINT ck_movimientos_inventario_metadata_json CHECK (
    metadata_json IS NULL OR json_valid(metadata_json)
  ),
  CONSTRAINT ck_movimientos_inventario_timestamps CHECK (
    ocurrido_en_ms >= 0 AND creado_en_ms >= 0
  ),
  CONSTRAINT ck_movimientos_inventario_creado_por CHECK (length(trim(creado_por)) > 0),
  CONSTRAINT ck_movimientos_inventario_no_autorreversion CHECK (
    revierte_movimiento_id IS NULL OR revierte_movimiento_id <> id
  )
);

CREATE INDEX idx_movimientos_inventario_variante_ubicacion_fecha
  ON movimientos_inventario (variante_id, ubicacion_id, ocurrido_en_ms);
CREATE INDEX idx_movimientos_inventario_referencia
  ON movimientos_inventario (referencia_origen)
  WHERE referencia_origen IS NOT NULL;
CREATE INDEX idx_movimientos_inventario_canal
  ON movimientos_inventario (canal_origen_id, ocurrido_en_ms)
  WHERE canal_origen_id IS NOT NULL;
CREATE INDEX idx_movimientos_inventario_reversion
  ON movimientos_inventario (revierte_movimiento_id)
  WHERE revierte_movimiento_id IS NOT NULL;

CREATE TRIGGER trg_movimientos_inventario_no_actualizar
BEFORE UPDATE ON movimientos_inventario
BEGIN
  SELECT RAISE(ABORT, 'Los movimientos de inventario son inmutables');
END;

CREATE TRIGGER trg_movimientos_inventario_no_eliminar
BEFORE DELETE ON movimientos_inventario
BEGIN
  SELECT RAISE(ABORT, 'Los movimientos de inventario no se eliminan; se revierten');
END;

-- Versiones de contenido reutilizable a nivel de producto y locale.
CREATE TABLE biblioteca_contenido (
  id TEXT NOT NULL,
  producto_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  version INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'BORRADOR',
  titulo_plantilla TEXT,
  descripcion_plantilla_html TEXT,
  generador TEXT,
  version_generador TEXT,
  hash_prompt TEXT,
  huella_origen TEXT,
  aprobado_en_ms INTEGER,
  aprobado_por TEXT,
  creado_en_ms INTEGER NOT NULL,
  actualizado_en_ms INTEGER NOT NULL,

  CONSTRAINT pk_biblioteca_contenido PRIMARY KEY (id),
  CONSTRAINT fk_biblioteca_contenido_producto FOREIGN KEY (producto_id)
    REFERENCES productos (id) ON DELETE RESTRICT,
  CONSTRAINT uq_biblioteca_contenido_version UNIQUE (producto_id, locale, version),
  CONSTRAINT ck_biblioteca_contenido_id_uuidv7 CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
    AND substr(id, 24, 1) = '-'
    AND lower(id) = id
    AND id NOT GLOB '*[^0-9a-f-]*'
  ),
  CONSTRAINT ck_biblioteca_contenido_locale CHECK (length(trim(locale)) > 0),
  CONSTRAINT ck_biblioteca_contenido_version CHECK (version >= 1),
  CONSTRAINT ck_biblioteca_contenido_estado CHECK (
    estado IN ('BORRADOR', 'GENERADO', 'REQUIERE_REVISION', 'APROBADO', 'RECHAZADO', 'REEMPLAZADO')
  ),
  CONSTRAINT ck_biblioteca_contenido_aprobacion CHECK (
    (estado = 'APROBADO' AND aprobado_en_ms IS NOT NULL AND length(trim(aprobado_por)) > 0)
    OR (estado <> 'APROBADO')
  ),
  CONSTRAINT ck_biblioteca_contenido_timestamps CHECK (
    creado_en_ms >= 0
    AND actualizado_en_ms >= creado_en_ms
    AND (aprobado_en_ms IS NULL OR aprobado_en_ms >= creado_en_ms)
  )
);

CREATE UNIQUE INDEX uq_biblioteca_contenido_aprobado
  ON biblioteca_contenido (producto_id, locale)
  WHERE estado = 'APROBADO';
CREATE INDEX idx_biblioteca_contenido_producto_estado
  ON biblioteca_contenido (producto_id, locale, estado, version);

-- Una version aprobada puede reemplazarse, pero su contenido no puede reescribirse.
CREATE TRIGGER trg_biblioteca_contenido_aprobado_no_reescribir
BEFORE UPDATE ON biblioteca_contenido
WHEN OLD.estado = 'APROBADO'
  AND (
    NEW.producto_id IS NOT OLD.producto_id
    OR NEW.locale IS NOT OLD.locale
    OR NEW.version IS NOT OLD.version
    OR NEW.titulo_plantilla IS NOT OLD.titulo_plantilla
    OR NEW.descripcion_plantilla_html IS NOT OLD.descripcion_plantilla_html
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

CREATE TRIGGER trg_biblioteca_contenido_aprobado_no_eliminar
BEFORE DELETE ON biblioteca_contenido
WHEN OLD.estado IN ('APROBADO', 'REEMPLAZADO')
BEGIN
  SELECT RAISE(ABORT, 'El contenido aprobado o reemplazado no puede eliminarse');
END;

-- Solo metadatos y URI; los binarios viven fuera de Turso.
CREATE TABLE recursos_contenido (
  id TEXT NOT NULL,
  biblioteca_contenido_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  origen TEXT NOT NULL,
  uri_almacenamiento TEXT NOT NULL,
  uri_origen TEXT,
  mime_type TEXT NOT NULL,
  hash_contenido TEXT,
  ancho INTEGER,
  alto INTEGER,
  duracion_ms INTEGER,
  texto_alt TEXT,
  posicion INTEGER NOT NULL DEFAULT 0,
  proveedor TEXT,
  id_recurso_proveedor TEXT,
  metadata_generacion_json TEXT,
  estado TEXT NOT NULL DEFAULT 'BORRADOR',
  creado_en_ms INTEGER NOT NULL,
  aprobado_en_ms INTEGER,
  archivado_en_ms INTEGER,

  CONSTRAINT pk_recursos_contenido PRIMARY KEY (id),
  CONSTRAINT fk_recursos_contenido_biblioteca FOREIGN KEY (biblioteca_contenido_id)
    REFERENCES biblioteca_contenido (id) ON DELETE RESTRICT,
  CONSTRAINT uq_recursos_contenido_posicion UNIQUE (biblioteca_contenido_id, posicion),
  CONSTRAINT ck_recursos_contenido_id_uuidv7 CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
    AND substr(id, 24, 1) = '-'
    AND lower(id) = id
    AND id NOT GLOB '*[^0-9a-f-]*'
  ),
  CONSTRAINT ck_recursos_contenido_tipo CHECK (
    tipo IN ('IMAGEN', 'VIDEO', 'MINIATURA', 'DOCUMENTO')
  ),
  CONSTRAINT ck_recursos_contenido_origen CHECK (
    origen IN ('ORIGINAL', 'IMPORTADO', 'GENERADO_IA', 'MANUAL')
  ),
  CONSTRAINT ck_recursos_contenido_uri CHECK (length(trim(uri_almacenamiento)) > 0),
  CONSTRAINT ck_recursos_contenido_mime CHECK (length(trim(mime_type)) > 0),
  CONSTRAINT ck_recursos_contenido_dimensiones CHECK (
    (ancho IS NULL OR ancho > 0)
    AND (alto IS NULL OR alto > 0)
    AND (duracion_ms IS NULL OR duracion_ms >= 0)
  ),
  CONSTRAINT ck_recursos_contenido_posicion CHECK (posicion >= 0),
  CONSTRAINT ck_recursos_contenido_metadata_json CHECK (
    metadata_generacion_json IS NULL OR json_valid(metadata_generacion_json)
  ),
  CONSTRAINT ck_recursos_contenido_estado CHECK (
    estado IN ('BORRADOR', 'PROCESANDO', 'REQUIERE_REVISION', 'APROBADO', 'RECHAZADO', 'ARCHIVADO')
  ),
  CONSTRAINT ck_recursos_contenido_aprobacion CHECK (
    estado <> 'APROBADO' OR aprobado_en_ms IS NOT NULL
  ),
  CONSTRAINT ck_recursos_contenido_timestamps CHECK (
    creado_en_ms >= 0
    AND (aprobado_en_ms IS NULL OR aprobado_en_ms >= creado_en_ms)
    AND (archivado_en_ms IS NULL OR archivado_en_ms >= creado_en_ms)
  )
);

CREATE INDEX idx_recursos_contenido_biblioteca_estado
  ON recursos_contenido (biblioteca_contenido_id, estado, posicion);
CREATE INDEX idx_recursos_contenido_hash
  ON recursos_contenido (hash_contenido)
  WHERE hash_contenido IS NOT NULL;
CREATE INDEX idx_recursos_contenido_pendiente_revision
  ON recursos_contenido (creado_en_ms)
  WHERE estado = 'REQUIERE_REVISION';

-- Una ejecucion agrupa snapshot, importacion o reconciliacion de un canal.
CREATE TABLE ejecuciones_sincronizacion (
  id TEXT NOT NULL,
  canal_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  direccion TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'PENDIENTE',
  cursor TEXT,
  iniciado_en_ms INTEGER NOT NULL,
  finalizado_en_ms INTEGER,
  elementos_vistos INTEGER NOT NULL DEFAULT 0,
  elementos_correctos INTEGER NOT NULL DEFAULT 0,
  elementos_fallidos INTEGER NOT NULL DEFAULT 0,
  hash_snapshot TEXT,
  resumen_error TEXT,
  metadata_json TEXT,

  CONSTRAINT pk_ejecuciones_sincronizacion PRIMARY KEY (id),
  CONSTRAINT fk_ejecuciones_sincronizacion_canal FOREIGN KEY (canal_id)
    REFERENCES canales (id) ON DELETE RESTRICT,
  CONSTRAINT ck_ejecuciones_sincronizacion_id_uuidv7 CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
    AND substr(id, 24, 1) = '-'
    AND lower(id) = id
    AND id NOT GLOB '*[^0-9a-f-]*'
  ),
  CONSTRAINT ck_ejecuciones_sincronizacion_tipo CHECK (
    tipo IN ('IMPORTACION_INICIAL', 'IMPORTACION_INCREMENTAL', 'RECONCILIACION', 'EXPORTACION')
  ),
  CONSTRAINT ck_ejecuciones_sincronizacion_direccion CHECK (
    direccion IN ('ENTRADA', 'SALIDA', 'BIDIRECCIONAL')
  ),
  CONSTRAINT ck_ejecuciones_sincronizacion_estado CHECK (
    estado IN ('PENDIENTE', 'EN_CURSO', 'SNAPSHOT_COMPLETO', 'COMPLETADA', 'FALLIDA', 'CANCELADA')
  ),
  CONSTRAINT ck_ejecuciones_sincronizacion_conteos CHECK (
    elementos_vistos >= 0
    AND elementos_correctos >= 0
    AND elementos_fallidos >= 0
    AND elementos_correctos + elementos_fallidos <= elementos_vistos
  ),
  CONSTRAINT ck_ejecuciones_sincronizacion_finalizacion CHECK (
    finalizado_en_ms IS NULL OR finalizado_en_ms >= iniciado_en_ms
  ),
  CONSTRAINT ck_ejecuciones_sincronizacion_estado_final CHECK (
    estado NOT IN ('COMPLETADA', 'FALLIDA', 'CANCELADA') OR finalizado_en_ms IS NOT NULL
  ),
  CONSTRAINT ck_ejecuciones_sincronizacion_metadata_json CHECK (
    metadata_json IS NULL OR json_valid(metadata_json)
  ),
  CONSTRAINT ck_ejecuciones_sincronizacion_inicio CHECK (iniciado_en_ms >= 0)
);

CREATE INDEX idx_ejecuciones_sincronizacion_canal_fecha
  ON ejecuciones_sincronizacion (canal_id, iniciado_en_ms);
CREATE INDEX idx_ejecuciones_sincronizacion_estado
  ON ejecuciones_sincronizacion (estado, iniciado_en_ms);

-- Snapshot JSON original e inmutable de cada entidad observada en un canal.
CREATE TABLE registros_externos_raw (
  id TEXT NOT NULL,
  ejecucion_id TEXT NOT NULL,
  canal_id TEXT NOT NULL,
  tipo_entidad TEXT NOT NULL,
  id_externo TEXT NOT NULL,
  id_externo_padre TEXT,
  actualizado_origen_en_ms INTEGER,
  payload_json TEXT NOT NULL,
  hash_payload TEXT NOT NULL,
  observado_en_ms INTEGER NOT NULL,
  estado_procesamiento TEXT NOT NULL DEFAULT 'PENDIENTE',
  error_procesamiento TEXT,

  CONSTRAINT pk_registros_externos_raw PRIMARY KEY (id),
  CONSTRAINT fk_registros_externos_raw_ejecucion FOREIGN KEY (ejecucion_id)
    REFERENCES ejecuciones_sincronizacion (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registros_externos_raw_canal FOREIGN KEY (canal_id)
    REFERENCES canales (id) ON DELETE RESTRICT,
  CONSTRAINT uq_registros_externos_raw_entidad UNIQUE (ejecucion_id, tipo_entidad, id_externo),
  CONSTRAINT ck_registros_externos_raw_id_uuidv7 CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
    AND substr(id, 24, 1) = '-'
    AND lower(id) = id
    AND id NOT GLOB '*[^0-9a-f-]*'
  ),
  CONSTRAINT ck_registros_externos_raw_tipo_entidad CHECK (
    tipo_entidad IN ('PRODUCTO', 'VARIANTE', 'ITEM_INVENTARIO', 'UBICACION', 'METAFIELD', 'MEDIA')
  ),
  CONSTRAINT ck_registros_externos_raw_id_externo CHECK (length(trim(id_externo)) > 0),
  CONSTRAINT ck_registros_externos_raw_payload_json CHECK (json_valid(payload_json)),
  CONSTRAINT ck_registros_externos_raw_hash CHECK (length(trim(hash_payload)) > 0),
  CONSTRAINT ck_registros_externos_raw_timestamps CHECK (
    observado_en_ms >= 0
    AND (actualizado_origen_en_ms IS NULL OR actualizado_origen_en_ms >= 0)
  ),
  CONSTRAINT ck_registros_externos_raw_estado CHECK (
    estado_procesamiento IN ('PENDIENTE', 'PROCESADO', 'REQUIERE_REVISION', 'SIN_COINCIDENCIA', 'ERROR')
  )
);

CREATE INDEX idx_registros_externos_raw_entidad_fecha
  ON registros_externos_raw (canal_id, tipo_entidad, id_externo, observado_en_ms);
CREATE INDEX idx_registros_externos_raw_procesamiento
  ON registros_externos_raw (ejecucion_id, estado_procesamiento);
CREATE INDEX idx_registros_externos_raw_hash
  ON registros_externos_raw (canal_id, tipo_entidad, hash_payload);

-- El raw puede cambiar de estado, pero nunca reescribir su evidencia original.
CREATE TRIGGER trg_registros_externos_raw_no_reescribir
BEFORE UPDATE OF
  ejecucion_id, canal_id, tipo_entidad, id_externo, id_externo_padre,
  actualizado_origen_en_ms, payload_json, hash_payload, observado_en_ms
ON registros_externos_raw
BEGIN
  SELECT RAISE(ABORT, 'Los datos raw originales son inmutables');
END;

CREATE TRIGGER trg_registros_externos_raw_no_eliminar
BEFORE DELETE ON registros_externos_raw
BEGIN
  SELECT RAISE(ABORT, 'Los datos raw no pueden eliminarse sin una politica de retencion');
END;

-- Candidatos y decisiones explicables de matching; nunca fusionan por si solos.
CREATE TABLE candidatos_coincidencia_catalogo (
  id TEXT NOT NULL,
  registro_raw_id TEXT NOT NULL,
  producto_candidato_id TEXT,
  variante_candidata_id TEXT,
  nivel_coincidencia TEXT NOT NULL,
  confianza_puntos_base INTEGER NOT NULL,
  razones_json TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'PENDIENTE',
  revisado_por TEXT,
  revisado_en_ms INTEGER,
  creado_en_ms INTEGER NOT NULL,

  CONSTRAINT pk_candidatos_coincidencia_catalogo PRIMARY KEY (id),
  CONSTRAINT fk_candidatos_coincidencia_registro_raw FOREIGN KEY (registro_raw_id)
    REFERENCES registros_externos_raw (id) ON DELETE RESTRICT,
  CONSTRAINT fk_candidatos_coincidencia_producto FOREIGN KEY (producto_candidato_id)
    REFERENCES productos (id) ON DELETE RESTRICT,
  CONSTRAINT fk_candidatos_coincidencia_variante FOREIGN KEY (variante_candidata_id)
    REFERENCES variantes_producto (id) ON DELETE RESTRICT,
  CONSTRAINT ck_candidatos_coincidencia_id_uuidv7 CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
    AND substr(id, 24, 1) = '-'
    AND lower(id) = id
    AND id NOT GLOB '*[^0-9a-f-]*'
  ),
  CONSTRAINT ck_candidatos_coincidencia_target CHECK (
    (producto_candidato_id IS NOT NULL AND variante_candidata_id IS NULL)
    OR (producto_candidato_id IS NULL AND variante_candidata_id IS NOT NULL)
  ),
  CONSTRAINT ck_candidatos_coincidencia_nivel CHECK (
    nivel_coincidencia IN ('FUERTE', 'MEDIA', 'DEBIL')
  ),
  CONSTRAINT ck_candidatos_coincidencia_confianza CHECK (
    confianza_puntos_base BETWEEN 0 AND 10000
  ),
  CONSTRAINT ck_candidatos_coincidencia_razones_json CHECK (json_valid(razones_json)),
  CONSTRAINT ck_candidatos_coincidencia_decision CHECK (
    decision IN (
      'PENDIENTE', 'AUTO_COINCIDENCIA', 'REQUIERE_REVISION',
      'COINCIDENCIA_APROBADA', 'COINCIDENCIA_RECHAZADA'
    )
  ),
  CONSTRAINT ck_candidatos_coincidencia_revision CHECK (
    (revisado_en_ms IS NULL AND revisado_por IS NULL)
    OR (revisado_en_ms >= 0 AND length(trim(revisado_por)) > 0)
  ),
  CONSTRAINT ck_candidatos_coincidencia_creado CHECK (creado_en_ms >= 0)
);

CREATE UNIQUE INDEX uq_candidatos_coincidencia_producto
  ON candidatos_coincidencia_catalogo (registro_raw_id, producto_candidato_id)
  WHERE producto_candidato_id IS NOT NULL;
CREATE UNIQUE INDEX uq_candidatos_coincidencia_variante
  ON candidatos_coincidencia_catalogo (registro_raw_id, variante_candidata_id)
  WHERE variante_candidata_id IS NOT NULL;
CREATE INDEX idx_candidatos_coincidencia_revision
  ON candidatos_coincidencia_catalogo (decision, confianza_puntos_base);

COMMIT;
