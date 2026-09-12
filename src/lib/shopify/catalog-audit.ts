import { shopifyGraphQL } from './client';

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface CatalogProduct {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  descriptionHtml: string;
  mediaCount: { count: number } | null;
  media: { nodes: Array<{ alt: string | null }> };
  options: Array<{
    name: string;
    optionValues: Array<{ name: string }>;
  }>;
}

interface CatalogVariant {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  selectedOptions: Array<{ name: string; value: string }>;
  product: { id: string };
  inventoryItem: {
    id: string;
    tracked: boolean;
    inventoryLevels: {
      nodes: Array<{
        location: { id: string; name: string };
        quantities: Array<{ name: string; quantity: number }>;
      }>;
    };
  };
}

interface CatalogLocation {
  id: string;
  name: string;
}

interface SampleMetafield {
  namespace: string;
  key: string;
  type: string;
}

interface Connection<T> {
  nodes: T[];
  pageInfo: PageInfo;
}

export interface DuplicateValue {
  value: string;
  count: number;
  ids: string[];
}

export interface AuditVariantRow {
  id: string;
  title: string;
  size: string;
  sku: string;
  barcode: string;
  price: string;
  compareAtPrice: string;
  stock: number | null;
  locations: string[];
  tracked: boolean;
  inventoryItemId: string;
}

export interface AuditProductRow {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  status: string;
  imageCount: number;
  variants: AuditVariantRow[];
}

export interface CatalogAudit {
  generatedAt: string;
  totals: {
    products: number;
    variants: number;
    active: number;
    draft: number;
    archived: number;
    averageVariants: number;
    maxVariants: number;
    maxVariantsProduct: string | null;
  };
  identification: {
    productsWithoutSku: number;
    variantsWithoutSku: number;
    duplicateSkus: DuplicateValue[];
    variantsWithoutBarcode: number;
    duplicateBarcodes: DuplicateValue[];
    duplicateHandles: DuplicateValue[];
    possibleDuplicateTitles: DuplicateValue[];
    vendors: string[];
    productTypes: string[];
    tags: string[];
  };
  sizes: {
    optionNames: Array<{ name: string; count: number }>;
    values: string[];
    productsWithoutSizeOption: number;
    singleVariantProducts: number;
    sizeLikelyInTitle: Array<{ id: string; title: string }>;
    inconsistentOptionNames: boolean;
  };
  inventory: {
    locations: CatalogLocation[];
    primaryLocation: string | null;
    locationVariantCounts: Array<{ name: string; variants: number; available: number }>;
    zeroStockVariants: number;
    positiveStockVariants: number;
    negativeStockVariants: number;
    unknownStockVariants: number;
    productsWithMultipleStockedVariants: number;
    trackedVariants: number;
    untrackedVariants: number;
    inventoryItems: number;
  };
  prices: {
    zeroPriceVariants: number;
    variantsWithoutCompareAtPrice: number;
    min: number | null;
    max: number | null;
    productsWithVariantPriceDifferences: number;
    zeroPriceExamples: Array<{ product: string; variant: string; id: string }>;
    highestPriceExamples: Array<{ product: string; variant: string; id: string; price: number }>;
  };
  content: {
    productsWithoutMedia: number;
    productsWithOneMedia: number;
    productsWithMultipleMedia: number;
    mediaTotal: number;
    sampledMediaWithoutAlt: number;
    sampledMediaTotal: number;
    productsWithoutDescription: number;
    averageDescriptionLength: number;
    maxDescriptionLength: number;
  };
  metafields: {
    sampledProducts: number;
    keys: Array<{ key: string; type: string; products: number }>;
  };
  issues: string[];
  sample: AuditProductRow[];
  limitations: string[];
}

const PRODUCTS_QUERY = `#graphql
  query AuditProducts($after: String) {
    products(first: 100, after: $after, sortKey: ID) {
      nodes {
        id title handle vendor productType tags status descriptionHtml
        mediaCount { count }
        media(first: 50) { nodes { alt } }
        options { name optionValues { name } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VARIANTS_QUERY = `#graphql
  query AuditVariants($after: String) {
    productVariants(first: 100, after: $after, sortKey: ID) {
      nodes {
        id title sku barcode price compareAtPrice inventoryQuantity
        selectedOptions { name value }
        product { id }
        inventoryItem {
          id tracked
          inventoryLevels(first: 50) {
            nodes {
              location { id name }
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const LOCATIONS_QUERY = `#graphql
  query AuditLocations($after: String) {
    locations(first: 100, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const METAFIELDS_QUERY = `#graphql
  query AuditMetafields($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        metafields(first: 20) {
          nodes { namespace key type }
        }
      }
    }
  }
`;

async function paginate<T>(
  field: string,
  query: string
): Promise<T[]> {
  const nodes: T[] = [];
  let after: string | null = null;

  do {
    const data: Record<string, Connection<T>> = await shopifyGraphQL(query, { after });
    const connection = data[field];

    if (!connection) throw new Error(`Shopify no devolvió la conexión ${field}.`);
    nodes.push(...connection.nodes);
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);

  return nodes;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('es').replace(/[^a-z0-9áéíóúüñ]+/g, ' ').trim();
}

function duplicates(
  values: Array<{ value: string | null; id: string }>,
  normalize = false
): DuplicateValue[] {
  const groups = new Map<string, { display: string; ids: string[] }>();

  for (const item of values) {
    const display = item.value?.trim();
    if (!display) continue;
    const key = normalize ? normalized(display) : display.toLocaleLowerCase('es');
    const group = groups.get(key) ?? { display, ids: [] };
    group.ids.push(item.id);
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.ids.length > 1)
    .map((group) => ({ value: group.display, count: group.ids.length, ids: group.ids }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function plainTextLength(html: string): number {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim().length;
}

function representativeIds(products: CatalogProduct[], count = 20): string[] {
  if (products.length <= count) return products.map((product) => product.id);

  return Array.from({ length: count }, (_, index) => {
    const position = Math.round((index * (products.length - 1)) / (count - 1));
    return products[position]!.id;
  });
}

async function getMetafieldSample(products: CatalogProduct[]): Promise<Map<string, SampleMetafield[]>> {
  const ids = representativeIds(products);
  if (ids.length === 0) return new Map();

  const data = await shopifyGraphQL<{
    nodes: Array<null | { id: string; metafields: { nodes: SampleMetafield[] } }>;
  }>(METAFIELDS_QUERY, { ids });

  return new Map(
    data.nodes
      .filter((node): node is NonNullable<typeof node> => node !== null)
      .map((node) => [node.id, node.metafields.nodes])
  );
}

function analyze(
  products: CatalogProduct[],
  variants: CatalogVariant[],
  locations: CatalogLocation[],
  metafields: Map<string, SampleMetafield[]>
): CatalogAudit {
  const variantsByProduct = new Map<string, CatalogVariant[]>();
  const productsById = new Map(products.map((product) => [product.id, product]));
  for (const variant of variants) {
    const group = variantsByProduct.get(variant.product.id) ?? [];
    group.push(variant);
    variantsByProduct.set(variant.product.id, group);
  }

  const variantCounts = products.map((product) => variantsByProduct.get(product.id)?.length ?? 0);
  const maxVariants = Math.max(0, ...variantCounts);
  const maxProductIndex = variantCounts.indexOf(maxVariants);
  const sizeNamePattern = /^(talla|tamaño|size|shoe size|número|numero)$/i;
  const sizeInTitlePattern = /(?:\btalla\s*)?\b(?:3[4-9]|4[0-9]|5[0-2])(?:[.,]5)?\s*(?:eu|us|uk|y)?\b/i;
  const sizeOptionCounts = new Map<string, number>();
  const sizeValues = new Set<string>();

  for (const product of products) {
    for (const option of product.options) {
      if (!sizeNamePattern.test(option.name.trim())) continue;
      sizeOptionCounts.set(option.name, (sizeOptionCounts.get(option.name) ?? 0) + 1);
      option.optionValues.forEach((value) => sizeValues.add(value.name));
    }
  }

  const priceValues = variants.map((variant) => Number(variant.price)).filter(Number.isFinite);
  const descriptionLengths = products.map((product) => plainTextLength(product.descriptionHtml));
  const locationUsage = new Map<string, { name: string; variants: number; available: number }>();

  for (const variant of variants) {
    for (const level of variant.inventoryItem.inventoryLevels.nodes) {
      const available = level.quantities.find((quantity) => quantity.name === 'available')?.quantity ?? 0;
      const current = locationUsage.get(level.location.id) ?? {
        name: level.location.name,
        variants: 0,
        available: 0
      };
      current.variants += 1;
      current.available += available;
      locationUsage.set(level.location.id, current);
    }
  }

  const metafieldKeys = new Map<string, { type: string; products: number }>();
  for (const fields of metafields.values()) {
    for (const field of fields) {
      const key = `${field.namespace}.${field.key}`;
      const current = metafieldKeys.get(key) ?? { type: field.type, products: 0 };
      current.products += 1;
      metafieldKeys.set(key, current);
    }
  }

  const duplicateSkus = duplicates(variants.map((variant) => ({ value: variant.sku, id: variant.id })));
  const duplicateBarcodes = duplicates(variants.map((variant) => ({ value: variant.barcode, id: variant.id })));
  const duplicateHandles = duplicates(products.map((product) => ({ value: product.handle, id: product.id })));
  const possibleDuplicateTitles = duplicates(
    products.map((product) => ({ value: product.title, id: product.id })),
    true
  );
  const productsWithoutSku = products.filter((product) =>
    (variantsByProduct.get(product.id) ?? []).every((variant) => !variant.sku?.trim())
  ).length;
  const productsWithoutSizeOption = products.filter(
    (product) => !product.options.some((option) => sizeNamePattern.test(option.name.trim()))
  );
  const locationVariantCounts = [...locationUsage.values()].sort(
    (a, b) => b.variants - a.variants || b.available - a.available
  );
  const sampledMedia = products.flatMap((product) => product.media.nodes);
  const productsWithVariantPriceDifferences = products.filter((product) => {
    const values = (variantsByProduct.get(product.id) ?? []).map((variant) => variant.price);
    return new Set(values).size > 1;
  }).length;

  const issues: string[] = [];
  if (duplicateSkus.length) issues.push(`${duplicateSkus.length} SKU duplicados.`);
  if (productsWithoutSku) issues.push(`${productsWithoutSku} productos no tienen SKU en ninguna variante.`);
  if (duplicateBarcodes.length) issues.push(`${duplicateBarcodes.length} barcodes duplicados.`);
  if (variants.some((variant) => !variant.barcode?.trim())) issues.push('La mayoría de variantes no tiene barcode informado.');
  if (productsWithoutSizeOption.length) issues.push(`${productsWithoutSizeOption.length} productos sin una opción de talla reconocible.`);
  if (variants.some((variant) => !variant.inventoryItem.tracked)) issues.push('Hay variantes con seguimiento de inventario desactivado.');
  if (variants.some((variant) => (variant.inventoryQuantity ?? 0) < 0)) issues.push('Hay variantes con inventario negativo.');
  if (variants.some((variant) => Number(variant.price) === 0)) issues.push('Hay variantes con precio cero.');
  if (products.some((product) => (product.mediaCount?.count ?? 0) === 0)) issues.push('Hay productos sin imágenes o media.');
  if (possibleDuplicateTitles.length) issues.push(`${possibleDuplicateTitles.length} grupos de títulos potencialmente duplicados.`);
  if (!issues.length) issues.push('No se detectaron incidencias con las reglas heurísticas de esta auditoría.');

  const sampleProducts = representativeIds(products)
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is CatalogProduct => product !== undefined);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      products: products.length,
      variants: variants.length,
      active: products.filter((product) => product.status === 'ACTIVE').length,
      draft: products.filter((product) => product.status === 'DRAFT').length,
      archived: products.filter((product) => product.status === 'ARCHIVED').length,
      averageVariants: products.length ? variants.length / products.length : 0,
      maxVariants,
      maxVariantsProduct: maxProductIndex >= 0 ? products[maxProductIndex]?.title ?? null : null
    },
    identification: {
      productsWithoutSku,
      variantsWithoutSku: variants.filter((variant) => !variant.sku?.trim()).length,
      duplicateSkus,
      variantsWithoutBarcode: variants.filter((variant) => !variant.barcode?.trim()).length,
      duplicateBarcodes,
      duplicateHandles,
      possibleDuplicateTitles,
      vendors: [...new Set(products.map((product) => product.vendor).filter(Boolean))].sort(),
      productTypes: [...new Set(products.map((product) => product.productType).filter(Boolean))].sort(),
      tags: [...new Set(products.flatMap((product) => product.tags))].sort()
    },
    sizes: {
      optionNames: [...sizeOptionCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      values: [...sizeValues].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      productsWithoutSizeOption: productsWithoutSizeOption.length,
      singleVariantProducts: products.filter((product) => (variantsByProduct.get(product.id)?.length ?? 0) === 1).length,
      sizeLikelyInTitle: productsWithoutSizeOption
        .filter((product) => sizeInTitlePattern.test(product.title))
        .map((product) => ({ id: product.id, title: product.title })),
      inconsistentOptionNames: sizeOptionCounts.size > 1
    },
    inventory: {
      locations,
      primaryLocation: locationVariantCounts[0]?.name ?? null,
      locationVariantCounts,
      zeroStockVariants: variants.filter((variant) => variant.inventoryQuantity === 0).length,
      positiveStockVariants: variants.filter((variant) => (variant.inventoryQuantity ?? 0) > 0).length,
      negativeStockVariants: variants.filter((variant) => (variant.inventoryQuantity ?? 0) < 0).length,
      unknownStockVariants: variants.filter((variant) => variant.inventoryQuantity === null).length,
      productsWithMultipleStockedVariants: products.filter(
        (product) => (variantsByProduct.get(product.id) ?? []).filter((variant) => (variant.inventoryQuantity ?? 0) > 0).length > 1
      ).length,
      trackedVariants: variants.filter((variant) => variant.inventoryItem.tracked).length,
      untrackedVariants: variants.filter((variant) => !variant.inventoryItem.tracked).length,
      inventoryItems: new Set(variants.map((variant) => variant.inventoryItem.id)).size
    },
    prices: {
      zeroPriceVariants: variants.filter((variant) => Number(variant.price) === 0).length,
      variantsWithoutCompareAtPrice: variants.filter((variant) => !variant.compareAtPrice).length,
      min: priceValues.length ? Math.min(...priceValues) : null,
      max: priceValues.length ? Math.max(...priceValues) : null,
      productsWithVariantPriceDifferences,
      zeroPriceExamples: variants
        .filter((variant) => Number(variant.price) === 0)
        .slice(0, 10)
        .map((variant) => ({
          product: productsById.get(variant.product.id)?.title ?? 'Producto desconocido',
          variant: variant.title,
          id: variant.id
        })),
      highestPriceExamples: [...variants]
        .sort((a, b) => Number(b.price) - Number(a.price))
        .slice(0, 10)
        .map((variant) => ({
          product: productsById.get(variant.product.id)?.title ?? 'Producto desconocido',
          variant: variant.title,
          id: variant.id,
          price: Number(variant.price)
        }))
    },
    content: {
      productsWithoutMedia: products.filter((product) => (product.mediaCount?.count ?? 0) === 0).length,
      productsWithOneMedia: products.filter((product) => product.mediaCount?.count === 1).length,
      productsWithMultipleMedia: products.filter((product) => (product.mediaCount?.count ?? 0) > 1).length,
      mediaTotal: products.reduce((sum, product) => sum + (product.mediaCount?.count ?? 0), 0),
      sampledMediaWithoutAlt: sampledMedia.filter((media) => !media.alt?.trim()).length,
      sampledMediaTotal: sampledMedia.length,
      productsWithoutDescription: descriptionLengths.filter((length) => length === 0).length,
      averageDescriptionLength: products.length
        ? Math.round(descriptionLengths.reduce((sum, length) => sum + length, 0) / products.length)
        : 0,
      maxDescriptionLength: Math.max(0, ...descriptionLengths)
    },
    metafields: {
      sampledProducts: metafields.size,
      keys: [...metafieldKeys].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.products - a.products)
    },
    issues,
    sample: sampleProducts.map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      vendor: product.vendor,
      productType: product.productType,
      status: product.status,
      imageCount: product.mediaCount?.count ?? 0,
      variants: (variantsByProduct.get(product.id) ?? []).map((variant) => ({
        id: variant.id,
        title: variant.title,
        size: variant.selectedOptions
          .filter((option) => sizeNamePattern.test(option.name.trim()))
          .map((option) => option.value)
          .join(', ') || '—',
        sku: variant.sku?.trim() || '—',
        barcode: variant.barcode?.trim() || '—',
        price: variant.price,
        compareAtPrice: variant.compareAtPrice ?? '—',
        stock: variant.inventoryQuantity,
        locations: variant.inventoryItem.inventoryLevels.nodes.map((level) => level.location.name),
        tracked: variant.inventoryItem.tracked,
        inventoryItemId: variant.inventoryItem.id
      }))
    })),
    limitations: [
      'Los nombres potencialmente duplicados y las tallas escritas en títulos se detectan mediante heurísticas.',
      'El alt text se inspecciona en los primeros 50 elementos media de cada producto; el recuento total usa mediaCount.',
      'Los metafields se consultan solo para una muestra distribuida de hasta 20 productos y hasta 20 metafields por producto.',
      'Los inventory levels se inspeccionan hasta un máximo de 50 locations por variante.'
    ]
  };
}

let cachedAudit: { value: CatalogAudit; expiresAt: number } | undefined;
let auditRequest: Promise<CatalogAudit> | undefined;

async function collectCatalogAudit(): Promise<CatalogAudit> {
  const [products, variants, locations] = await Promise.all([
    paginate<CatalogProduct>('products', PRODUCTS_QUERY),
    paginate<CatalogVariant>('productVariants', VARIANTS_QUERY),
    paginate<CatalogLocation>('locations', LOCATIONS_QUERY)
  ]);
  const metafields = await getMetafieldSample(products);
  return analyze(products, variants, locations, metafields);
}

export async function getCatalogAudit(): Promise<CatalogAudit> {
  if (cachedAudit && cachedAudit.expiresAt > Date.now()) return cachedAudit.value;

  auditRequest ??= collectCatalogAudit();
  try {
    const value = await auditRequest;
    cachedAudit = { value, expiresAt: Date.now() + 10 * 60 * 1000 };
    return value;
  } finally {
    auditRequest = undefined;
  }
}
