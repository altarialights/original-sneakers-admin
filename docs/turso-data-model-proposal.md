# Diseño de datos Turso/libSQL

> **Estado: DISEÑO APROBADO PARA MIGRACIÓN INICIAL**

Este documento consolida las decisiones aprobadas para el catálogo, inventario, canales, contenido e importación. La implementación normativa del esquema es [`migrations/001_inicial.sql`](../migrations/001_inicial.sql).

Fuente de evidencia: [auditoría real del catálogo Shopify](./shopify-catalog-audit.md), capturada el 2 de septiembre de 2026.

## 1. Decisiones aprobadas

1. El inventario del MVP usa cantidad por variante y ubicación más un ledger inmutable. No existe `unidades_inventario`.
2. Un producto canónico representa modelo + colorway/referencia. La talla pertenece a la variante.
3. Todos los IDs internos son UUIDv7 en `TEXT`. Los IDs Shopify, SKU, barcode, título y handle nunca son primary keys internas.
4. Shopify continúa como fuente de verdad durante importación, normalización, reconciliación y shadow mode. El futuro cutover será explícito y no forma parte de esta migración.
5. Solo se permite auto-match con evidencia fuerte. Título o SKU aislados nunca fusionan productos.
6. La talla se normaliza sin destruir el dato original ni inferir conversiones dudosas.
7. La importación inicial conserva snapshots JSON raw completos de Shopify.
8. El contenido reutilizable pertenece al producto canónico. Los assets generados con IA requieren aprobación.
9. El MVP no normaliza proveedores, compras ni facturas. El movimiento `COMPRA` puede conservar coste, proveedor y referencia de factura.
10. El acceso futuro será Turso/libSQL directo, sin ORM, con SQL explícito y migraciones append-only.

## 2. Convenciones definitivas

- Tablas, columnas, constraints, índices, triggers, comentarios y estados internos: español, `snake_case`, ASCII sin tildes ni `ñ`.
- Términos técnicos reconocibles se mantienen cuando mejoran la precisión: `id`, `uuid`, `sku`, `barcode`, `json`, `hash`, `locale`, `mime_type`, `shopify`.
- Dinero: `INTEGER` en céntimos. Nunca `REAL`.
- Timestamps: `INTEGER`, Unix epoch en milisegundos UTC, sufijo `_en_ms`.
- Booleanos: `INTEGER` con `CHECK (... IN (0, 1))`.
- JSON: `TEXT` con `json_valid`.
- IDs internos: UUIDv7 canónico en minúsculas, validado estructuralmente por `CHECK`.
- Foreign keys históricas: `ON DELETE RESTRICT`.
- Borrado lógico: estados `ARCHIVADO` o timestamps `archivado_en_ms` donde existe ciclo de vida. Historial y raw no se borran desde el flujo ordinario.

`PRAGMA foreign_keys = ON` abre la migración y también deberá ejecutarse/verificarse en cada conexión futura. Turso/libSQL lo mantiene desactivado por defecto por compatibilidad con SQLite.

## 3. Tablas definitivas

La migración inicial crea exactamente 12 tablas:

### Catálogo

#### `productos`

Responsabilidad: identidad canónica compartida por todas las tallas de un modelo + colorway/referencia.

| Columna | Tipo | Null | Significado |
| --- | --- | --- | --- |
| `id` | `TEXT` | no | UUIDv7 interno e inmutable |
| `titulo_canonico` | `TEXT` | no | Título aprobado sin talla |
| `marca_original` | `TEXT` | sí | Grafía conservada |
| `marca_normalizada` | `TEXT` | sí | Valor comparable |
| `nombre_modelo` | `TEXT` | sí | Modelo extraído/aprobado |
| `colorway_original` | `TEXT` | sí | Colorway de origen |
| `colorway_normalizado` | `TEXT` | sí | Colorway comparable |
| `referencia_original` | `TEXT` | sí | Referencia conservada |
| `referencia_normalizada` | `TEXT` | sí | Referencia limpia |
| `clave_normalizada` | `TEXT` | sí | Clave para candidatos, nunca identidad |
| `version_normalizacion` | `INTEGER` | no | Versión del algoritmo |
| `tipo_producto` | `TEXT` | sí | Dominio canónico |
| `estado` | `TEXT` | no | Ciclo de vida |
| `estado_revision` | `TEXT` | no | Calidad/aprobación |
| `creado_en_ms` | `INTEGER` | no | Alta |
| `actualizado_en_ms` | `INTEGER` | no | Último cambio |
| `archivado_en_ms` | `INTEGER` | sí | Archivado lógico |

Enums:

- `tipo_producto`: `CALZADO`, `ROPA`, `ACCESORIO`, `OTRO`.
- `estado`: `BORRADOR`, `ACTIVO`, `ARCHIVADO`.
- `estado_revision`: `SIN_REVISAR`, `REQUIERE_REVISION`, `APROBADO`, `RECHAZADO`.

La `clave_normalizada` tiene índice, pero no `UNIQUE`: datos incompletos pueden producir colisiones entre colorways o ediciones distintas.

#### `variantes_producto`

Responsabilidad: combinación vendible de un producto, normalmente una talla.

| Columna | Tipo | Null | Significado |
| --- | --- | --- | --- |
| `id` | `TEXT` | no | UUIDv7 interno |
| `producto_id` | `TEXT` | no | Producto canónico |
| `titulo_variante` | `TEXT` | sí | Etiqueta humana |
| `sku_original` / `sku_normalizado` | `TEXT` | sí | Evidencia y valor comparable |
| `barcode_original` / `barcode_normalizado` | `TEXT` | sí | Evidencia y valor comparable |
| `talla_original` | `TEXT` | sí | Valor exacto de origen |
| `sistema_talla` | `TEXT` | sí | Sistema clasificado |
| `valor_talla_milesimas` | `INTEGER` | sí | Talla numérica escalada por 1.000 |
| `etiqueta_talla` | `TEXT` | sí | XS/S/M/L u otra etiqueta |
| `longitud_pie_mm` | `INTEGER` | sí | Longitud fiable en milímetros |
| `grupo_edad` | `TEXT` | sí | Segmento de edad |
| `publico_genero` | `TEXT` | sí | Público/género separado de talla |
| `firma_opciones_json` | `TEXT` | no | Opciones canónicas deterministas |
| `precio_centimos` | `INTEGER` | no | Precio actual |
| `precio_comparacion_centimos` | `INTEGER` | sí | Precio anterior/comparativo |
| `moneda` | `TEXT` | no | Código ISO de tres letras |
| `estado` | `TEXT` | no | Ciclo de vida |
| `requiere_revision` | `INTEGER` | no | Booleano de calidad |
| timestamps | `INTEGER` | — | Creación, actualización y archivado |

Enums:

- `sistema_talla`: `EU`, `US`, `UK`, `CM`, `ALFABETICO`, `EDAD`, `ALTURA`, `DESCONOCIDO`.
- `grupo_edad`: `BEBE`, `INFANTIL`, `ADULTO`, `DESCONOCIDO`.
- `publico_genero`: `UNISEX`, `HOMBRE`, `MUJER`, `NINO`, `NINA`, `DESCONOCIDO`.
- `estado`: `BORRADOR`, `ACTIVO`, `ARCHIVADO`.

`UNIQUE(producto_id, firma_opciones_json)` evita repetir una combinación dentro del mismo producto. SKU y barcode no son únicos porque la auditoría demuestra ausencias y colisiones.

`valor_talla_milesimas` permite ordenar, comparar y buscar rangos sin `REAL`: 36 se representa como `36000`, 36,5 como `36500` y 42⅔ como aproximadamente `42667` únicamente cuando la fuente expresa realmente esa fracción. El campo es nullable y tiene `CHECK (valor_talla_milesimas IS NULL OR valor_talla_milesimas > 0)`. Las tallas alfabéticas dejan este valor en `NULL` y usan `etiqueta_talla`.

### Inventario

#### `ubicaciones_inventario`

Responsabilidad: almacenes, tiendas o ubicaciones internas. El Shopify Location GID nunca es su PK.

Columnas: `id`, `codigo`, `nombre`, `tipo`, `esta_activa`, `creado_en_ms`, `actualizado_en_ms`.

- `codigo` es único.
- `tipo`: `ALMACEN`, `TIENDA`, `TRANSITO`, `VIRTUAL`.
- Una ubicación con historial se desactiva; no se elimina.

#### `niveles_inventario`

Responsabilidad: saldo materializado por variante y ubicación.

Columnas: `variante_id`, `ubicacion_id`, `cantidad`, `version`, `actualizado_en_ms`.

- PK compuesta: `(variante_id, ubicacion_id)`.
- `cantidad >= 0` es obligatorio.
- `version >= 0` prepara control optimista de concurrencia.
- El saldo solo podrá cambiar en una transacción que cree su movimiento correspondiente.

#### `movimientos_inventario`

Responsabilidad: ledger inmutable de cada cambio de stock.

| Grupo | Columnas |
| --- | --- |
| Identidad | `id`, `clave_idempotencia` |
| Stock | `variante_id`, `ubicacion_id`, `ubicacion_destino_id`, `tipo`, `delta`, `saldo_posterior` |
| Origen | `origen`, `canal_origen_id`, `referencia_origen` |
| Compra MVP | `coste_unitario_centimos`, `moneda_coste`, `proveedor_original`, `referencia_factura` |
| Auditoría | `metadata_json`, `ocurrido_en_ms`, `creado_en_ms`, `creado_por`, `revierte_movimiento_id` |

Tipos:

- `SALDO_INICIAL`
- `COMPRA`
- `VENTA`
- `DEVOLUCION_ENTRADA`, `DEVOLUCION_SALIDA`
- `AJUSTE_ENTRADA`, `AJUSTE_SALIDA`
- `CORRECCION_SINCRONIZACION`
- `TRANSFERENCIA_ENTRADA`, `TRANSFERENCIA_SALIDA`
- `DANO`

Origen: `MANUAL`, `SISTEMA`, `IMPORTACION`, `CANAL`.

La base valida signo por tipo, `delta <> 0`, `saldo_posterior >= 0`, coherencia del coste/moneda, transfers entre ubicaciones distintas y canal obligatorio cuando `origen = CANAL`. La clave de idempotencia es globalmente única.

Dos triggers rechazan cualquier `UPDATE` o `DELETE`. Los errores se corrigen mediante un nuevo movimiento que usa `revierte_movimiento_id`.

### Canales

#### `canales`

Responsabilidad: cuentas/canales externos o internos sin alterar el catálogo.

Columnas: `id`, `codigo`, `nombre`, `tipo`, `esta_activo`, `configuracion_json`, `creado_en_ms`, `actualizado_en_ms`.

Tipos definitivos: `SHOPIFY`, `VINTED`, `WALLAPOP`, `MIRAVIA`, `TIKTOK`, `INSTAGRAM`, `WHATSAPP`, `REVENDEDOR`, `TIENDA_FISICA`.

`codigo` es único y permite varias cuentas futuras del mismo tipo. `configuracion_json` nunca contiene tokens ni secretos.

#### `mapeos_canal`

Responsabilidad: mapping central de IDs externos, con estado de publicación únicamente cuando la entidad es publicable y estado de sincronización obligatorio para todas las entidades.

| Columna | Uso |
| --- | --- |
| `id`, `canal_id`, `tipo_entidad` | Identidad y canal |
| `producto_id`, `variante_id`, `ubicacion_id` | Target interno exclusivo |
| `mapeo_padre_id` | Variante/listing subordinado a un producto del canal |
| `id_externo`, `handle_externo` | Identidad externa exacta |
| `estado_publicacion` | Estado comercial del listing |
| `estado_sincronizacion` | Salud del sync |
| timestamps/error | Trazabilidad |

Tipos de entidad: `PRODUCTO`, `VARIANTE`, `ITEM_INVENTARIO`, `UBICACION`.

Estado de publicación: `BORRADOR`, `PUBLICADO`, `NO_PUBLICADO`, `ARCHIVADO`, `REQUIERE_ELIMINACION`. Es obligatorio para `PRODUCTO` y `VARIANTE`, y debe ser `NULL` para `ITEM_INVENTARIO` y `UBICACION`.

Estado de sincronización: `PENDIENTE`, `SINCRONIZADO`, `DESINCRONIZADO`, `ERROR`, `BLOQUEADO`.

`UNIQUE(canal_id, tipo_entidad, id_externo)` impide duplicar una entidad externa dentro del canal. No se impone unicidad sobre el target interno: varios productos Shopify separados por talla pueden terminar apuntando al mismo producto canónico. Un `CHECK` exige exactamente un target correcto, otro separa entidades publicables y no publicables, y los triggers verifican que un padre sea un mapeo `PRODUCTO` del mismo canal.

Mappings Shopify:

- Product GID → `PRODUCTO` + `producto_id`.
- Variant GID → `VARIANTE` + `variante_id`.
- InventoryItem GID → `ITEM_INVENTARIO` + `variante_id`.
- Location GID → `UBICACION` + `ubicacion_id`.

### Contenido

#### `biblioteca_contenido`

Responsabilidad: una versión de texto/contenido reutilizable para producto + locale.

Columnas: `id`, `producto_id`, `locale`, `version`, `estado`, `titulo_plantilla`, `descripcion_plantilla_html`, `generador`, `version_generador`, `hash_prompt`, `huella_origen`, `aprobado_en_ms`, `aprobado_por`, `creado_en_ms`, `actualizado_en_ms`.

Estados: `BORRADOR`, `GENERADO`, `REQUIERE_REVISION`, `APROBADO`, `RECHAZADO`, `REEMPLAZADO`.

- `UNIQUE(producto_id, locale, version)` versiona el contenido.
- Un índice parcial único permite una sola versión `APROBADO` por producto + locale.
- La aprobación exige fecha y responsable.
- Un trigger impide reescribir contenido aprobado; solo permite conservarlo o marcarlo `REEMPLAZADO`.
- El contenido aprobado/reemplazado no se elimina.

#### `recursos_contenido`

Responsabilidad: metadatos y URI de assets. Los binarios no se almacenan en Turso.

Columnas: `id`, `biblioteca_contenido_id`, `tipo`, `origen`, `uri_almacenamiento`, `uri_origen`, `mime_type`, `hash_contenido`, dimensiones/duración, `texto_alt`, `posicion`, proveedor externo, metadata de generación, estado y timestamps.

- Tipo: `IMAGEN`, `VIDEO`, `MINIATURA`, `DOCUMENTO`.
- Origen: `ORIGINAL`, `IMPORTADO`, `GENERADO_IA`, `MANUAL`.
- Estado: `BORRADOR`, `PROCESANDO`, `REQUIERE_REVISION`, `APROBADO`, `RECHAZADO`, `ARCHIVADO`.
- `UNIQUE(biblioteca_contenido_id, posicion)` mantiene orden sin colisiones.
- `hash_contenido` tiene índice no único: detecta candidatos duplicados sin impedir reutilización legítima.

Para responder “¿existe contenido aprobado para este modelo?”, se consulta `biblioteca_contenido` por `producto_id + locale + APROBADO` y luego sus recursos aprobados. La talla no participa.

### Importación y matching

#### `ejecuciones_sincronizacion`

Responsabilidad: checkpoint y resumen de una importación, reconciliación o futura exportación.

Columnas: `id`, `canal_id`, `tipo`, `direccion`, `estado`, `cursor`, timestamps, contadores, `hash_snapshot`, `resumen_error`, `metadata_json`.

- Tipo: `IMPORTACION_INICIAL`, `IMPORTACION_INCREMENTAL`, `RECONCILIACION`, `EXPORTACION`.
- Dirección: `ENTRADA`, `SALIDA`, `BIDIRECCIONAL`.
- Estado: `PENDIENTE`, `EN_CURSO`, `SNAPSHOT_COMPLETO`, `COMPLETADA`, `FALLIDA`, `CANCELADA`.
- Los estados finales requieren `finalizado_en_ms`.
- Los contadores nunca pueden ser negativos ni superar elementos vistos.

#### `registros_externos_raw`

Responsabilidad: snapshot JSON original por entidad observada.

Columnas: `id`, `ejecucion_id`, `canal_id`, `tipo_entidad`, `id_externo`, `id_externo_padre`, `actualizado_origen_en_ms`, `payload_json`, `hash_payload`, `observado_en_ms`, `estado_procesamiento`, `error_procesamiento`.

Tipos: `PRODUCTO`, `VARIANTE`, `ITEM_INVENTARIO`, `UBICACION`, `METAFIELD`, `MEDIA`.

Estados: `PENDIENTE`, `PROCESADO`, `REQUIERE_REVISION`, `SIN_COINCIDENCIA`, `ERROR`.

`UNIQUE(ejecucion_id, tipo_entidad, id_externo)` hace idempotente la captura dentro del run. Payload, hash, identidad y observación son inmutables mediante trigger. Solo puede evolucionar el estado de procesamiento. Un segundo trigger evita borrado sin una futura política explícita de retención.

#### `candidatos_coincidencia_catalogo`

Responsabilidad: candidatos explicables; nunca fusiona por sí misma.

Columnas: `id`, `registro_raw_id`, target producto o variante, `nivel_coincidencia`, `confianza_puntos_base`, `razones_json`, `decision`, revisión y timestamps.

- Nivel: `FUERTE`, `MEDIA`, `DEBIL`.
- Decisión: `PENDIENTE`, `AUTO_COINCIDENCIA`, `REQUIERE_REVISION`, `COINCIDENCIA_APROBADA`, `COINCIDENCIA_RECHAZADA`.
- Confianza: entero 0–10.000, no `REAL`.
- Exactamente uno de `producto_candidato_id` o `variante_candidata_id` debe existir.
- Índices parciales únicos impiden repetir el mismo candidato para un raw.
- Un raw sin candidatos usa `registros_externos_raw.estado_procesamiento = SIN_COINCIDENCIA`.

## 4. Tabla descartada del esquema inicial

`eventos_sincronizacion` queda fuera del MVP.

Justificación: `ejecuciones_sincronizacion` ya conserva estado global, cursor, conteos y error; `registros_externos_raw` conserva estado/error por objeto; `mapeos_canal` conserva salud y último error del mapping. Añadir ahora otro log duplicaría responsabilidades antes de conocer necesidades operativas reales.

Se añadirá en una migración posterior si necesitamos historial de reintentos, telemetría por acción o exportaciones complejas. No se guardarán esos datos prematuramente en columnas ambiguas.

También quedan fuera:

- `unidades_inventario`: aprobado inventario por cantidad.
- proveedores/compras/facturas: coste y referencias viven temporalmente en `movimientos_inventario`.
- tablas maestras de marca/categoría/tag: primero se debe normalizar el catálogo real.

## 5. Producto, variante y deduplicación

### Producto

Ejemplo: Nike Dunk Low Panda, DD1391-100, Black/White. Comparte marca, modelo, referencia, colorway y contenido.

### Variante

Ejemplo: Nike Dunk Low Panda, talla EU 42. Contiene talla, opciones, SKU/barcode si existen y precio.

Los 404 productos Shopify cuya talla parece estar en el título se almacenan primero como raw independientes. Solo después pueden varios listings `PRODUCTO` apuntar al mismo producto canónico y sus listings `VARIANTE` a variantes distintas.

### Clave normalizada

`clave_normalizada` genera candidatos, no identidad. Ejemplo conceptual versionado:

```text
v1|marca=NIKE|referencia=DD1391-100|modelo=DUNK-LOW|color=BLACK-WHITE
```

No se inventan componentes ausentes y solo se retira talla con confianza alta.

### Evidencia

Fuerte:

- mapping externo aprobado previamente;
- referencia limpia + marca + colorway confirmado;
- barcode válido, único y consistente para una variante.

Media:

- referencia + marca sin colorway;
- marca + modelo + colorway normalizados;
- relaciones explícitas en metafields.

Débil:

- título similar;
- SKU aislado;
- tags, vendor, tipo, precio o imagen similares.

Solo evidencia fuerte sin contradicción puede producir `AUTO_COINCIDENCIA`. Título o SKU aislados nunca fusionan. Referencias o colorways contradictorios fuerzan `REQUIERE_REVISION` independientemente del score.

## 6. Normalización de tallas

Siempre se conserva `talla_original`. La prioridad de evidencia será: opción de variante aprobada, metafield específico, título y por último tags.

Automático seguro:

- `40 EU - 26 cm` → `EU`, valor escalado `40000`, longitud `260` mm.
- `36.5 EU` → `EU`, valor escalado `36500`.
- `XS`…`XXL` → `ALFABETICO`, etiqueta correspondiente.
- `0-6 meses` → `EDAD`, conservando el rango original.

Requiere revisión:

- números sin sistema (`36`, `40`);
- `38.5 Unisex` sin sistema explícito;
- centímetros sin unidad;
- contradicción entre opción, título y metafield;
- valores contaminados con el nombre del producto;
- conversiones EU/US/UK/cm no confirmadas para marca y público.

## 7. Inventario y atomicidad futura

El saldo actual se consulta en `niveles_inventario`; la explicación histórica se consulta en `movimientos_inventario`.

Invariante conceptual:

```text
niveles_inventario.cantidad
= SUM(movimientos_inventario.delta)
por variante y ubicacion desde SALDO_INICIAL
```

El futuro servicio deberá usar una transacción de escritura corta:

1. validar idempotencia;
2. actualizar el nivel con `version` esperada y condición `cantidad + delta >= 0`;
3. exigir una fila afectada;
4. insertar movimiento con saldo posterior;
5. commit o rollback completo.

No habrá llamadas Shopify ni red externa dentro de la transacción. Transferir stock produce `TRANSFERENCIA_SALIDA` y `TRANSFERENCIA_ENTRADA` atómicos. Una corrección crea un movimiento inverso; nunca edita el ledger.

Las dos variantes Shopify con stock negativo permanecen raw y pendientes. No pueden crear un saldo canónico negativo ni convertirse silenciosamente en cero.

## 8. Contenido reutilizable

Las tallas 42, 43 y 44 del mismo modelo/colorway comparten `producto_id`; por tanto consultan la misma versión aprobada en `biblioteca_contenido`.

Flujo futuro:

1. resolver producto canónico;
2. buscar contenido `APROBADO` para producto + locale;
3. reutilizarlo si existe;
4. si no existe, crear versión `GENERADO`/`REQUIERE_REVISION`;
5. aprobar antes de publicar;
6. cualquier edición crea una versión nueva y reemplaza conceptualmente la anterior.

Los binarios viven en object storage. Turso guarda URI, hash, dimensiones, proveedor, origen, alt y estado.

## 9. Importación inicial aprobada conceptualmente

La importación todavía no se implementa. Cuando Martín apruebe `001_inicial.sql`, seguirá estas fases:

1. **Snapshot read-only:** crear ejecución, paginar Shopify y guardar raw con hashes y cursores.
2. **Validación:** reconciliar 533 productos, 1.016 variantes, una location y 1.016 inventory items contra el snapshot base.
3. **Normalización:** extraer señales sin tocar raw y versionar reglas.
4. **Matching:** crear candidatos; auto-match solo fuerte.
5. **Revisión:** resolver stocks negativos, precios anómalos, duplicados, tallas y relaciones.
6. **Materialización:** crear IDs internos, mappings y contenido; no se espera relación 1:1 entre productos Shopify y canónicos.
7. **Saldo inicial:** crear niveles/movimientos únicamente después de validar inventario.
8. **Shadow mode:** comparar Turso y Shopify sin publicar cambios.
9. **Cutover futuro:** operación explícita, separada y aprobada.

Idempotencia:

- raw único por ejecución/tipo/id externo;
- mappings únicos por canal/tipo/id externo;
- movimientos únicos por clave de idempotencia;
- candidatos únicos mediante índices parciales;
- un run fallido puede reanudarse por cursor/estado o repetirse como un run nuevo.

Rollback antes del cutover significa descartar o archivar procesamiento canónico del run: Shopify no cambia. Después de materializar inventario, las correcciones son compensatorias, no destructivas.

## 10. Constraints e índices clave

Protecciones principales:

- UUIDv7 estructural en toda PK interna.
- FKs `ON DELETE RESTRICT` para catálogo, inventario, canales, contenido y raw.
- `cantidad >= 0`, precios/costes no negativos y booleanos 0/1.
- JSON válido en opciones, metadata, configuración, raw y razones.
- `UNIQUE` para códigos internos, firma de variante, idempotencia, IDs externos y versiones de contenido.
- Índice parcial único de contenido aprobado.
- Índices parciales para stock positivo, revisiones, recursos pendientes, mappings tipados y candidatos.
- Índice `(sistema_talla, valor_talla_milesimas, etiqueta_talla)` para ordenación y rangos numéricos por sistema.
- Triggers de inmutabilidad para movimientos y raw.
- Triggers de protección para contenido aprobado y parent listings.

SQLite no permite subconsultas en `CHECK`; por eso reglas que cruzan tablas se resuelven con FK, triggers concretos o futuras transacciones de dominio. La migración evita constraints que parezcan seguras pero no puedan garantizarse realmente.

## 11. Diagrama definitivo

```text
productos
  ├──< variantes_producto
  │      ├──< niveles_inventario >── ubicaciones_inventario
  │      └──< movimientos_inventario >── ubicaciones_inventario
  │                    └──────────────> canales (origen opcional)
  │
  └──< biblioteca_contenido
           └──< recursos_contenido

canales
  ├──< mapeos_canal >── productos
  │          │             ├── variantes_producto
  │          │             └── ubicaciones_inventario
  │          └── mapeo_padre_id ──> mapeos_canal
  │
  └──< ejecuciones_sincronizacion
          └──< registros_externos_raw
                    └──< candidatos_coincidencia_catalogo
                               ├──> productos
                               └──> variantes_producto
```

## 12. Ejemplos reales

### Producto correctamente agrupado

`Tensaur Run 3.0`, con 11 variantes observadas:

- un `productos` por modelo/colorway;
- once `variantes_producto` por tallas/opciones;
- una biblioteca de contenido compartida;
- mappings separados para Shopify Product, Variant e InventoryItem;
- un nivel y movimientos por variante.

Los SKU `AD-TENSAUR-*` repetidos son evidencia, no identidad suficiente.

### Productos separados por talla

Patrón: `Talla 39 Dunk Panda`, `Talla 40 Dunk Panda`, `Talla 41 Dunk Panda`.

Cada objeto Shopify entra raw por separado. El parser propone talla y producto base. Si referencia + marca + colorway coinciden con evidencia fuerte, pueden apuntar a un producto canónico con tres variantes. Si solo coincide el título, quedan `REQUIERE_REVISION`.

### Sin SKU ni barcode

La variante recibe UUIDv7 interno. SKU/barcode original y normalizado permanecen null. El mapping fiable se realiza con Shopify GIDs en `mapeos_canal`. No se inventa un SKU ni se bloquea el alta.

## 13. Política de migraciones

```text
migrations/
  001_inicial.sql
  002_descripcion_futura.sql
  003_backfill_futuro.sql
```

- Append-only: una migración aplicada nunca se modifica.
- DDL y backfills complejos se separan.
- Usar transacciones cuando proceda.
- Antes de cambios destructivos: backup/branch y prueba real de restauración.
- Aplicar expand/migrate/contract para compatibilidad entre despliegues.
- Verificar `foreign_keys`, `foreign_key_check`, integridad y checks.
- Ninguna migración mezcla SQL local con llamadas a Shopify.
- Elegir cliente Turso/libSQL directo al implementar; esta fase no instala ninguno.

## 14. Validación de `001_inicial.sql`

Validada localmente contra SQLite vacío en memoria con Node `node:sqlite`:

- 12 tablas creadas.
- 35 índices explícitos creados.
- 8 triggers creados.
- `PRAGMA foreign_key_check`: sin incidencias.
- cantidad negativa: rechazada.
- clave de idempotencia duplicada: rechazada.
- external ID duplicado para mismo canal/tipo: rechazado.
- mapping `PRODUCTO` con `estado_publicacion = PUBLICADO`: aceptado.
- mapping `ITEM_INVENTARIO` con `estado_publicacion` no null: rechazado.
- mapping `UBICACION` con `estado_publicacion` no null: rechazado.
- FK huérfana: rechazada.
- actualización de movimiento: rechazada.
- reescritura de payload raw: rechazada.
- rango EU entre `40000` y `43000`: devuelve `42000` y `42667` en orden numérico.
- plan de consulta del rango: utiliza `idx_variantes_producto_talla`.

No se abrió ninguna conexión Turso remota y no se insertaron datos reales.

## 15. Límites de esta migración

`001_inicial.sql` crea únicamente estructura. No:

- instala `@libsql/client` ni ORM;
- configura URL o token Turso;
- crea una base remota;
- importa, normaliza o deduplica Shopify;
- crea niveles o movimientos reales;
- cambia el cutover;
- modifica Shopify o ejecuta mutations;
- implementa Vinted;
- cambia la UI.

## Referencias técnicas

- [SQLite: CREATE TABLE y constraints](https://sqlite.org/lang_createtable.html)
- [Turso: PRAGMA y foreign keys](https://docs.turso.tech/sql-reference/pragmas)
- [Turso/libSQL: transacciones TypeScript](https://docs.turso.tech/sdk/ts/reference)
- [Turso: libSQL y Turso Database](https://docs.turso.tech/libsql)
