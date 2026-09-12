# Auditoría estructural del catálogo Shopify

Fecha de la captura: 2 de septiembre de 2026.

Esta auditoría es exclusivamente de lectura. Se obtuvo mediante GraphQL Admin API `2026-07`, recorriendo con paginación todos los productos y todas las variantes disponibles. No se ejecutó ninguna mutation y no se almacenaron credenciales ni access tokens en este documento.

## Resumen ejecutivo

El catálogo contiene 533 productos y 1.016 variantes. La estructura no es homogénea: conviven productos que agrupan tallas como variantes con muchos productos cuyo título ya incorpora una talla concreta. Esta diferencia es el principal riesgo para una futura normalización.

Los IDs de Shopify, handles, relaciones variante–producto, `inventoryItem` y seguimiento de inventario son las señales más consistentes. SKU, barcode, títulos, tallas, tags, `productType` y algunos precios requieren limpieza o reglas de confianza antes de utilizarlos como identificadores o dimensiones maestras.

## 1. Catálogo general

| Métrica | Resultado |
| --- | ---: |
| Productos | 533 |
| Variantes | 1.016 |
| Productos activos | 383 |
| Productos draft | 150 |
| Productos archivados | 0 |
| Media de variantes por producto | 1,91 |
| Máximo de variantes en un producto | 11 |
| Producto con el máximo | `Tensaur Run 3.0` |
| Productos con una sola variante | 336 |

La media esconde dos patrones: una mayoría de productos muy específicos con una única variante y un grupo menor que sí utiliza variantes para representar tallas u otras opciones.

## 2. Identificación y duplicados

### IDs y handles

- Los productos, variantes e inventory items tienen IDs globales Shopify (`gid://shopify/...`) y deben considerarse identificadores externos fiables.
- No se encontraron handles duplicados. Shopify mantiene su unicidad en el catálogo consultado.
- Se encontraron 68 grupos de títulos potencialmente duplicados tras normalizar mayúsculas, espacios y puntuación. Son candidatos a revisión, no duplicados confirmados: el color, la referencia o alguna otra diferencia puede vivir fuera del título.
- Ejemplos repetidos: `Talla 38.5 Jordan 1 Mid` (4), `Talla 39 Nike Phantom GX II Academy FG/MG` (4), `Talla 40 Jordan 1 Mid` (4), `Talla 38 Air Force 1` (3) y `Tensaur Run 3.0` (3).

### SKU

| Métrica | Resultado |
| --- | ---: |
| Productos sin SKU en ninguna variante | 361 de 533 |
| Variantes sin SKU | 740 de 1.016 |
| Grupos de SKU duplicados | 33 |

El SKU no es actualmente un identificador fiable. Además de la ausencia generalizada, el campo mezcla formatos incompatibles:

- Referencias limpias, por ejemplo `AR3565-012`.
- Referencias que incorporan texto, emoji o talla, por ejemplo `📦 Ref: DN3577-100 talla 38.5`.
- Un valor con aspecto de dato importado de Amazon, `ASIN: B0F5KZ4Q14`, se repite en 53 variantes.
- Referencias como `AR3565-012`, `HF0406-102` y `HF7004-005` se repiten seis veces cada una.

Una repetición puede ser válida si representa varias tallas del mismo modelo, pero el campo no permite distinguir de forma estable entre referencia de modelo, SKU de variante y texto descriptivo.

### Barcode / UPC

| Métrica | Resultado |
| --- | ---: |
| Variantes sin barcode | 886 de 1.016 |
| Grupos de barcode duplicados | 10 |

Los barcodes tampoco son una clave fiable en el estado actual. Algunos incluyen prefijos o emoji (`🌐 UPC:` o `UPC:`), y un mismo valor llega a aparecer 16 veces. Antes de comparar o validar unicidad será necesario separar el número normalizado de cualquier texto decorativo.

### Vendor, productType y tags

- Se encontraron 21 valores de vendor. Hay al menos una inconsistencia puramente tipográfica: `Adidas` y `adidas`.
- Solo existen seis `productType`, pero contienen duplicidades semánticas: `Chándal` / `Chándals`. También aparecen `Camisetas`, `Pantalones`, `Sudadera` y `Zapatillas`.
- Hay 303 tags distintos. Mezclan categorías, marcas, colores, género, tallas, promociones, SEO y envío.
- Existen variantes ortográficas o de formato como `talla`, `tala`, `tall`, valores con espacio, guion o dos puntos, y `tipo:runnig`.
- Al menos un tag contiene una frase SEO completa. Por tanto, los tags sirven como señal auxiliar, pero no como taxonomía canónica sin normalización.

## 3. Tallas y opciones

| Métrica | Resultado |
| --- | ---: |
| Productos con opción de talla reconocible | 104 |
| Productos sin opción de talla reconocible | 429 |
| De los anteriores, con talla probable en el título | 404 |
| Nombres distintos detectados | `Talla` y `Talla ` |
| Valores de talla distintos | 57 |

Hay dos nombres técnicamente diferentes debido a espacios finales: `Talla` en 102 productos y `Talla ` en 2. No se encontró `Size` en esta captura.

Los 57 valores mezclan dominios diferentes:

- Calzado EU y centímetros: `38 EU - 24 cm`, `41 EU - 26 cm`.
- Tallas con género o público: `36 Unisex`, `M - Mujer`.
- Ropa: `XXS`, `XS`, `S`, `M`, `L`, `XL`, `XXL`.
- Infantil por edad o altura: `Kids 4 años`, `Kids L 140-155 cm`, `0-6 meses`.
- Valores que incluyen el nombre del producto: `Pantalón Jordan Talla S`, `Sudadera CR7 Talla S`.
- Diferencias incompletas o incompatibles: `37.5 EU - 23.5` frente a `37.5 EU - 23.5 cm`.

La talla tampoco debe extraerse únicamente del título sin conservar el original. Ejemplos como `Talla 38Y`, `38.5`, tallas infantiles, ropa y centímetros necesitan una clasificación consciente del tipo de producto. Los 25 productos sin opción reconocible y sin coincidencia heurística en el título requieren revisión manual o una fuente adicional.

## 4. Inventario

| Métrica | Resultado |
| --- | ---: |
| Locations | 1 (`Original Sneakers`) |
| Variantes asociadas a esa location | 1.016 |
| Unidades disponibles agregadas | 1.077 |
| Variantes con stock positivo | 884 |
| Variantes con stock cero | 130 |
| Variantes con stock negativo | 2 |
| Stock desconocido (`null`) | 0 |
| Productos con varias variantes en stock | 181 |
| Variantes con tracking activo | 1.016 |
| Variantes con tracking inactivo | 0 |
| Inventory items distintos | 1.016 |

La parte estructural del inventario es consistente: existe un inventory item distinto por variante, todo el catálogo tiene tracking activo y todos los niveles observados pertenecen a la única location. Las dos cantidades negativas son una incidencia real que debe conservarse como dato de origen y revisarse; no debe transformarse silenciosamente en cero.

`inventoryQuantity` es el agregado de la variante. Para futuras sincronizaciones conviene conservar también la dimensión por location aunque hoy solo exista una, porque la estructura de Shopify ya está preparada para múltiples ubicaciones.

## 5. Precios

| Métrica | Resultado |
| --- | ---: |
| Rango observado | 0 € – 6.990 € |
| Variantes con precio 0 | 20 |
| Variantes sin compareAtPrice | 149 |
| Productos con precios diferentes entre variantes | 6 |

El máximo de 6.990 € corresponde a `Talla 41 Pacific Leather`; el siguiente precio más alto es 149,90 €, por lo que 6.990 € es un outlier muy probable y debe revisarse.

Los 20 precios cero también necesitan validación. Entre los ejemplos están `Talla 39 Nike Court Borough Recraft`, varias variantes de `Talla 41 Air Pegasus Wave`, `Talla 35.5 Star Runner 4 NN (GS)` y `Talla 31 Air Max Solo (PS)`.

La ausencia de `compareAtPrice` no implica necesariamente un error: puede significar que no existe un precio anterior o promocional. Debe mantenerse nullable y no inferirse a partir de `price`.

## 6. Imágenes y contenido

| Métrica | Resultado |
| --- | ---: |
| Media total | 3.219 |
| Productos sin media | 21 |
| Productos con una sola media | 39 |
| Productos con varias media | 473 |
| Elementos media sin alt text | 36 de 3.219 inspeccionados |
| Productos sin descripción | 0 |
| Longitud media aproximada | 1.042 caracteres |
| Longitud máxima aproximada | 1.749 caracteres |

La cobertura de imágenes y descripciones es buena en términos cuantitativos. Los 21 productos sin media son una incidencia clara. El alt text está presente en la gran mayoría de elementos inspeccionados, aunque los 36 vacíos deberían poder distinguirse de un valor desconocido.

La longitud se calculó sobre texto aproximado tras retirar etiquetas HTML. `descriptionHtml` debe conservarse sin intentar reconstruirlo desde esa longitud o desde texto plano.

## 7. Metafields

Se tomó una muestra distribuida de 20 productos, con un máximo de 20 metafields por producto. Se encontraron 26 claves distintas. No se copiaron sus valores al informe; se analizaron clave, tipo y frecuencia.

Presentes en los 20 productos muestreados:

- `global.description_tag` (`string`).
- `custom.pickup_option_1` (`single_line_text_field`).
- `custom.shipping_option_1` (`single_line_text_field`).

Muy frecuentes:

- `shopify.shoe-size` y `shopify.color-pattern` en 19 de 20.
- `global.title_tag` en 19 de 20.
- Metafields taxonómicos de Shopify como `closure-type`, `shoe-fit`, `occasion-style`, `target-gender`, `age-group`, `shoe-features`, `footwear-material`, `activity`, `toe-style`, `heel-height-type` y `sneaker-style`.

Personalizados y menos uniformes:

- `custom.edad`, `custom.publico_objetivo` y `custom.talla`.
- `custom.categoria`, `custom.subcategoria_calzado` y `custom.subcategoria_ropa`.
- `custom.otras_tallas` y `custom.productos_relacionados`, ambos de tipo `list.product_reference`.
- `shopify.size` aparece en un producto y convive con `shopify.shoe-size`.

Estos campos no deben descartarse en una futura migración. En especial, los metafields de referencia contienen relaciones que no pueden reconstruirse con seguridad desde el título o los tags. La muestra demuestra su existencia, no su cobertura completa en los 533 productos.

## 8. Evaluación de calidad

### Datos que parecen fiables

- IDs globales de producto, variante, inventory item y location.
- Relación entre variante, producto e inventory item.
- Handle como identificador legible único dentro de Shopify, aunque no debe sustituir al ID estable.
- Estado del producto.
- Tracking de inventario y cantidades de origen, incluyendo cero y negativos.
- Precio y compareAtPrice como valores de Shopify, conservando null y cero sin reinterpretarlos.
- Recuento de media y `descriptionHtml` como contenido de origen.

### Datos que no deben tratarse como canónicos sin normalización

- SKU y barcode: ausentes, duplicados y con texto decorativo.
- Talla: repartida entre opciones, títulos, tags y metafields, con formatos incompatibles.
- Título como identidad de modelo: incluye talla y tiene duplicados potenciales.
- Vendor: diferencias de capitalización.
- `productType`: singular/plural y cobertura taxonómica limitada.
- Tags: alta entropía, erratas y mezcla de finalidades.
- Precio 6.990 € y precios cero: valores válidos técnicamente, pero sospechosos comercialmente.

### Riesgos principales

1. Fusionar productos por título podría unir artículos diferentes o separar tallas del mismo modelo de forma incorrecta.
2. Usar SKU o barcode como clave única produciría colisiones y dejaría fuera gran parte del catálogo.
3. Convertir la talla directamente a un número perdería tallas textiles, infantiles, género, sistema EU y centímetros.
4. Tomar `inventoryQuantity` como un booleano disponible/no disponible ocultaría cantidades negativas y el detalle por location.
5. Ignorar metafields perdería taxonomía, relaciones entre productos y opciones logísticas personalizadas.
6. Limpiar los datos destructivamente durante la importación impediría reconstruir o auditar el valor original.

## 9. Recomendaciones previas al futuro diseño de Turso

Estas recomendaciones son criterios de diseño, no una propuesta de tablas definitiva:

- Conservar siempre IDs Shopify y valores originales junto a cualquier valor normalizado.
- Separar identidad de modelo, producto publicado y variante solo después de definir reglas verificables para referencias, títulos y tallas.
- No imponer unicidad a SKU o barcode con los datos actuales. Normalizar prefijos, emoji, espacios y guiones antes de evaluar posibles claves.
- Representar talla como dato compuesto: valor original, sistema o dominio, medida normalizada cuando sea posible y confianza de la inferencia.
- Mantener inventario por inventory item y location; calcular agregados como vistas derivadas.
- Preservar `null`, cero y valores negativos como estados diferentes.
- Mantener precio y compareAtPrice separados y añadir validaciones de outliers sin corregir automáticamente el origen.
- Conservar `descriptionHtml`, media, alt text y orden de media.
- Inventariar todos los metafields antes de la migración definitiva, incluyendo tipos y referencias, no solo los valores encontrados en esta muestra.
- Crear un proceso explícito de deduplicación con revisión humana para los 68 grupos de títulos y las referencias repetidas.
- Normalizar vendor, productType y tags mediante diccionarios controlados, conservando el texto Shopify original.

## 10. Limitaciones de la auditoría

- La detección de títulos duplicados y talla en título es heurística; indica candidatos, no errores confirmados.
- El alt text se consultó en los primeros 50 elementos media por producto. Ningún producto de esta captura superó ese límite, por lo que se inspeccionaron los 3.219 elementos contados.
- Los metafields se limitaron a una muestra distribuida de 20 productos y 20 campos por producto para evitar consultas excesivas.
- Se consultaron hasta 50 inventory levels por variante. Solo existe una location en la captura, por lo que no hubo truncamiento efectivo.
- La captura representa el estado del catálogo en la fecha indicada; productos, stock y precios pueden cambiar después.
- Los scopes disponibles permitieron leer productos, variantes, inventario, locations, media y metafields consultados. No se observó ningún error de permisos durante la captura.
