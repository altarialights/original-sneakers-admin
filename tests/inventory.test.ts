import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createClient, type Client } from '@libsql/client';
import {
  addVariants,
  adjustStock,
  archiveProduct,
  createProduct,
  updateProduct
} from '../src/lib/inventory/mutations.ts';
import {
  approvePhotoInventory,
  parsePhotoApprovalPayload,
  type PhotoApprovalInput
} from '../src/lib/inventory/photo-approval.ts';
import { DuplicateProductError, DuplicateVariantError, InventoryError } from '../src/lib/inventory/errors.ts';
import { uuidV7 } from '../src/lib/inventory/ids.ts';
import { moneyToCents } from '../src/lib/inventory/normalization.ts';
import { getProductDetail, listProducts } from '../src/lib/inventory/queries.ts';
import type { CreateProductInput, VariantFieldsInput } from '../src/lib/inventory/types.ts';

interface TestDatabase { client: Client; directory: string; locationId: string; }

async function createTestDatabase(): Promise<TestDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'original-sneakers-inventory-'));
  const databasePath = join(directory, 'inventory.sqlite').replaceAll('\\', '/');
  const client = createClient({ url: `file:${databasePath}`, intMode: 'number' });
  await client.executeMultiple(await readFile(new URL('../migrations/001_inicial.sql', import.meta.url), 'utf8'));
  const locationId = uuidV7();
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO ubicaciones_inventario
          (id, codigo, nombre, tipo, esta_activa, creado_en_ms, actualizado_en_ms)
          VALUES (?, 'TIENDA', 'Tienda', 'TIENDA', 1, ?, ?)`,
    args: [locationId, now, now]
  });
  return { client, directory, locationId };
}

async function usingDatabase(callback: (database: TestDatabase) => Promise<void>): Promise<void> {
  const database = await createTestDatabase();
  try {
    await callback(database);
  } finally {
    database.client.close();
    (globalThis as { gc?: () => void }).gc?.();
    await rm(database.directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function variant(overrides: Partial<VariantFieldsInput> = {}): VariantFieldsInput {
  return {
    size: '40',
    sizeSystem: 'EU',
    quantity: 2,
    pvpCents: 11_999,
    offerCents: 9_990,
    costCents: 5_000,
    barcode: '123456789012',
    location: 'Tienda',
    gender: 'UNISEX',
    ageGroup: 'ADULTO',
    ...overrides
  };
}

function product(overrides: Partial<CreateProductInput> = {}): CreateProductInput {
  return {
    brand: 'Nike',
    model: 'Dunk Low Test',
    reference: 'TEST-100',
    colorway: 'Negro / Blanco',
    type: 'CALZADO',
    variants: [variant()],
    ...overrides
  };
}

function photoApproval(overrides: {
  sessionId?: string;
  type?: 'CALZADO' | 'ROPA';
  size?: string;
  sizeSystem?: PhotoApprovalInput['variante']['sistemaTalla'];
  quantity?: number;
  gtin?: string | null;
  costCents?: number | null;
  footLengthMm?: number | null;
  equivalences?: Record<string, string>;
} = {}): PhotoApprovalInput {
  const type = overrides.type ?? 'ROPA';
  return {
    sessionId: overrides.sessionId ?? uuidV7(),
    tipoProducto: type,
    producto: {
      marca: 'Nike', modelo: type === 'ROPA' ? 'AIR GRAPHIC TEE' : 'AIR MAX DN8',
      referencia: type === 'ROPA' ? 'HM0185-489' : 'II7634-001', colorway: 'Azul',
      genero: 'HOMBRE', tipoPrenda: type === 'ROPA' ? 'Camiseta' : null
    },
    variante: {
      talla: overrides.size ?? (type === 'ROPA' ? 'L' : '45'),
      sistemaTalla: overrides.sizeSystem ?? (type === 'ROPA' ? 'ALFABETICO' : 'EU'),
      gtin: overrides.gtin === undefined ? null : overrides.gtin,
      cantidad: overrides.quantity ?? 1,
      equivalencias: overrides.equivalences ?? (type === 'CALZADO' ? { EU: '45', CM: '29' } : {}),
      longitudPieMm: type === 'CALZADO' ? overrides.footLengthMm ?? 290 : null
    },
    compra: { costeUnitarioCentimos: overrides.costCents ?? 499, proveedor: 'Nike', fechaCompra: '2026-09-15' }
  };
}

async function count(client: Client, table: string): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) AS total FROM ${table}`);
  return Number(result.rows[0]?.total ?? 0);
}

test('listar productos usa datos persistidos', () => usingDatabase(async ({ client }) => {
  await createProduct(product(), client);
  const products = await listProducts({}, client);
  assert.equal(products.length, 1);
  assert.equal(products[0].reference, 'TEST-100');
  assert.equal(products[0].stock, 2);
}));

test('detalle devuelve producto, variante, coste y ubicación', () => usingDatabase(async ({ client }) => {
  const created = await createProduct(product(), client);
  const detail = await getProductDetail(created.productId, client);
  assert.equal(detail?.variants.length, 1);
  assert.equal(detail?.variants[0].costCents, 5_000);
  assert.equal(detail?.variants[0].locations[0].name, 'Tienda');
  assert.equal(detail?.stock, 2);
}));

test('alta crea producto, variante, movimiento y nivel', () => usingDatabase(async ({ client }) => {
  await createProduct(product(), client);
  assert.equal(await count(client, 'productos'), 1);
  assert.equal(await count(client, 'variantes_producto'), 1);
  assert.equal(await count(client, 'movimientos_inventario'), 1);
  assert.equal(await count(client, 'niveles_inventario'), 1);
}));

test('alta con varias variantes crea un solo producto', () => usingDatabase(async ({ client }) => {
  await createProduct(product({ variants: [variant(), variant({ size: '41', barcode: '123456789013' }), variant({ size: '42', barcode: null })] }), client);
  assert.equal(await count(client, 'productos'), 1);
  assert.equal(await count(client, 'variantes_producto'), 3);
  assert.equal(await count(client, 'movimientos_inventario'), 3);
}));

test('impide crear un producto canónico duplicado', () => usingDatabase(async ({ client }) => {
  const created = await createProduct(product(), client);
  await assert.rejects(createProduct(product({ brand: ' nike ', model: 'DUNK LOW TEST' }), client), (error) => {
    assert.ok(error instanceof DuplicateProductError);
    assert.equal(error.productId, created.productId);
    return true;
  });
  assert.equal(await count(client, 'productos'), 1);
}));

test('impide añadir una variante talla/sistema duplicada', () => usingDatabase(async ({ client }) => {
  const created = await createProduct(product(), client);
  await assert.rejects(addVariants(created.productId, [variant({ quantity: 1 })], client), DuplicateVariantError);
  assert.equal(await count(client, 'variantes_producto'), 1);
}));

test('ajuste +1 crea movimiento y aumenta el nivel', () => usingDatabase(async ({ client, locationId }) => {
  const created = await createProduct(product(), client);
  const detail = await getProductDetail(created.productId, client);
  const result = await adjustStock(detail!.variants[0].id, { locationId, reason: 'AJUSTE', delta: 1 }, client);
  assert.equal(result.quantity, 3);
  assert.equal(await count(client, 'movimientos_inventario'), 2);
}));

test('ajuste -1 crea movimiento y reduce el nivel', () => usingDatabase(async ({ client, locationId }) => {
  const created = await createProduct(product(), client);
  const detail = await getProductDetail(created.productId, client);
  const result = await adjustStock(detail!.variants[0].id, { locationId, reason: 'VENTA', delta: -1 }, client);
  assert.equal(result.quantity, 1);
  const movement = await client.execute(`SELECT tipo, delta FROM movimientos_inventario ORDER BY creado_en_ms DESC LIMIT 1`);
  assert.equal(movement.rows[0].tipo, 'VENTA');
  assert.equal(Number(movement.rows[0].delta), -1);
}));

test('impide stock negativo sin crear movimiento', () => usingDatabase(async ({ client, locationId }) => {
  const created = await createProduct(product(), client);
  const detail = await getProductDetail(created.productId, client);
  await assert.rejects(adjustStock(detail!.variants[0].id, { locationId, reason: 'VENTA', delta: -3 }, client), (error) => error instanceof InventoryError && error.code === 'STOCK_NEGATIVO');
  assert.equal(await count(client, 'movimientos_inventario'), 1);
}));

test('dar de baja archiva sin borrar ni modificar stock', () => usingDatabase(async ({ client }) => {
  const created = await createProduct(product(), client);
  const movementsBefore = await count(client, 'movimientos_inventario');
  await archiveProduct(created.productId, true, client);
  const row = await client.execute({ sql: 'SELECT estado, archivado_en_ms FROM productos WHERE id = ?', args: [created.productId] });
  assert.equal(row.rows[0].estado, 'ARCHIVADO');
  assert.ok(Number(row.rows[0].archivado_en_ms) > 0);
  assert.equal(await count(client, 'niveles_inventario'), 1);
  assert.equal(await count(client, 'movimientos_inventario'), movementsBefore);
}));

test('editar producto no altera stock ni movimientos', () => usingDatabase(async ({ client }) => {
  const created = await createProduct(product(), client);
  await updateProduct(created.productId, { brand: 'Nike', model: 'Dunk Low Editado', reference: 'TEST-100', colorway: 'Negro', type: 'CALZADO' }, client);
  const detail = await getProductDetail(created.productId, client);
  assert.equal(detail?.model, 'Dunk Low Editado');
  assert.equal(detail?.stock, 2);
  assert.equal(await count(client, 'movimientos_inventario'), 1);
}));

test('un error transaccional no deja estado parcial', () => usingDatabase(async ({ client }) => {
  await assert.rejects(createProduct(product({ variants: [variant(), variant({ size: '41', location: 'No existe' })] }), client), /ubicación indicada no existe/i);
  assert.equal(await count(client, 'productos'), 0);
  assert.equal(await count(client, 'variantes_producto'), 0);
  assert.equal(await count(client, 'movimientos_inventario'), 0);
  assert.equal(await count(client, 'niveles_inventario'), 0);
}));

test('aprobación por fotos crea producto, variante, nivel y compra', () => usingDatabase(async ({ client }) => {
  const result = await approvePhotoInventory(photoApproval(), client);
  assert.match(result.productId, /^[0-9a-f-]{36}$/);
  assert.equal(result.productCreated, true);
  assert.equal(result.variantCreated, true);
  assert.equal(result.quantity, 1);
  assert.equal(await count(client, 'productos'), 1);
  assert.equal(await count(client, 'variantes_producto'), 1);
  assert.equal(await count(client, 'niveles_inventario'), 1);
  assert.equal(await count(client, 'movimientos_inventario'), 1);
  const movement = await client.execute('SELECT tipo, origen, delta, coste_unitario_centimos, proveedor_original, metadata_json FROM movimientos_inventario');
  assert.equal(movement.rows[0].tipo, 'COMPRA');
  assert.equal(movement.rows[0].origen, 'MANUAL');
  assert.equal(Number(movement.rows[0].delta), 1);
  assert.equal(Number(movement.rows[0].coste_unitario_centimos), 499);
  assert.equal(movement.rows[0].proveedor_original, 'Nike');
  assert.equal(JSON.parse(String(movement.rows[0].metadata_json)).metodo_alta, 'FOTOS');
}));

test('producto existente reutiliza producto y crea una variante nueva', () => usingDatabase(async ({ client }) => {
  const first = await approvePhotoInventory(photoApproval({ size: 'L' }), client);
  const second = await approvePhotoInventory(photoApproval({ size: 'XL' }), client);
  assert.equal(second.productId, first.productId);
  assert.equal(second.productCreated, false);
  assert.equal(second.variantCreated, true);
  assert.equal(await count(client, 'productos'), 1);
  assert.equal(await count(client, 'variantes_producto'), 2);
}));

test('producto y variante existentes incrementan stock sin duplicarlos', () => usingDatabase(async ({ client }) => {
  const first = await approvePhotoInventory(photoApproval({ quantity: 2 }), client);
  const second = await approvePhotoInventory(photoApproval({ quantity: 1 }), client);
  assert.equal(second.productId, first.productId);
  assert.equal(second.variantId, first.variantId);
  assert.equal(second.productCreated, false);
  assert.equal(second.variantCreated, false);
  assert.equal(second.quantity, 3);
  assert.equal(await count(client, 'productos'), 1);
  assert.equal(await count(client, 'variantes_producto'), 1);
  assert.equal(await count(client, 'movimientos_inventario'), 2);
}));

test('misma talla EU y mismo GTIN reutilizan variante, suman stock y crean una nueva COMPRA', () => usingDatabase(async ({ client }) => {
  const first = await approvePhotoInventory(photoApproval({
    type: 'CALZADO', gtin: '00198481328581', quantity: 1, costCents: 499
  }), client);
  const second = await approvePhotoInventory(photoApproval({
    type: 'CALZADO', gtin: '00198481328581', quantity: 1, costCents: 3_999
  }), client);
  assert.equal(second.productId, first.productId);
  assert.equal(second.variantId, first.variantId);
  assert.equal(second.variantCreated, false);
  assert.equal(second.quantity, 2);
  assert.equal(await count(client, 'variantes_producto'), 1);
  assert.equal(await count(client, 'movimientos_inventario'), 2);
  const movements = await client.execute('SELECT tipo, delta, coste_unitario_centimos, proveedor_original FROM movimientos_inventario ORDER BY creado_en_ms');
  assert.deepEqual(movements.rows.map((row) => [row.tipo, Number(row.delta)]), [['COMPRA', 1], ['COMPRA', 1]]);
  assert.equal(Number(movements.rows[1].coste_unitario_centimos), 3_999);
  assert.equal(movements.rows[1].proveedor_original, 'Nike');
}));

test('el propietario exacto del GTIN se reutiliza aunque su firma histórica no coincida', () => usingDatabase(async ({ client }) => {
  const first = await approvePhotoInventory(photoApproval({ type: 'CALZADO', gtin: '00198481328581' }), client);
  await client.execute({
    sql: 'UPDATE variantes_producto SET firma_opciones_json = ? WHERE id = ?',
    args: ['{"formato_historico":true}', first.variantId]
  });
  const second = await approvePhotoInventory(photoApproval({ type: 'CALZADO', gtin: '00198481328581' }), client);
  assert.equal(second.variantId, first.variantId);
  assert.equal(second.quantity, 2);
  assert.equal(await count(client, 'variantes_producto'), 1);
}));

test('mismo GTIN con talla diferente bloquea y revierte toda la segunda alta', () => usingDatabase(async ({ client }) => {
  await approvePhotoInventory(photoApproval({ type: 'CALZADO', size: '42', gtin: '00198481328581' }), client);
  await assert.rejects(
    approvePhotoInventory(photoApproval({ type: 'CALZADO', size: '45', gtin: '00198481328581' }), client),
    (error) => error instanceof InventoryError && error.code === 'GTIN_DUPLICADO' && /42 EU/.test(error.message)
  );
  assert.equal(await count(client, 'variantes_producto'), 1);
  assert.equal(await count(client, 'movimientos_inventario'), 1);
}));

test('equivalencias secundarias ambiguas no bloquean una variante identificada por EU y GTIN', () => usingDatabase(async ({ client }) => {
  const first = await approvePhotoInventory(photoApproval({ type: 'CALZADO', gtin: '00198481328581' }), client);
  const second = await approvePhotoInventory(photoApproval({
    type: 'CALZADO', gtin: '00198481328581', equivalences: { EU: '45' }, footLengthMm: null
  }), client);
  assert.equal(second.variantId, first.variantId);
  assert.equal(second.quantity, 2);
  const metadata = await client.execute({ sql: 'SELECT metadata_json FROM movimientos_inventario WHERE id = ?', args: [second.movementId] });
  assert.deepEqual(JSON.parse(String(metadata.rows[0].metadata_json)).equivalencias_talla, { EU: '45' });
}));

test('una sesión nueva del mismo GTIN incrementa; repetir esa sesión no vuelve a sumar', () => usingDatabase(async ({ client }) => {
  const firstInput = photoApproval({ type: 'CALZADO', gtin: '00198481328581' });
  const secondInput = photoApproval({ type: 'CALZADO', gtin: '00198481328581' });
  const first = await approvePhotoInventory(firstInput, client);
  const second = await approvePhotoInventory(secondInput, client);
  const repeated = await approvePhotoInventory(secondInput, client);
  assert.notEqual(second.movementId, first.movementId);
  assert.equal(second.quantity, 2);
  assert.equal(repeated.movementId, second.movementId);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.quantity, 2);
  assert.equal(await count(client, 'movimientos_inventario'), 2);
}));

test('doble aprobación con la misma sesión es idempotente y no suma dos veces', () => usingDatabase(async ({ client }) => {
  const input = photoApproval({ quantity: 1 });
  const first = await approvePhotoInventory(input, client);
  const second = await approvePhotoInventory(input, client);
  assert.equal(first.movementId, second.movementId);
  assert.equal(second.idempotent, true);
  assert.equal(second.quantity, 1);
  assert.equal(await count(client, 'movimientos_inventario'), 1);
}));

test('cantidad inválida se rechaza antes de escribir', () => usingDatabase(async ({ client }) => {
  const raw = photoApproval() as unknown as Record<string, any>;
  raw.variante.cantidad = 0;
  raw.variante.longitudPieCm = null;
  delete raw.variante.longitudPieMm;
  assert.throws(() => parsePhotoApprovalPayload(raw), /mayor que cero/);
  assert.equal(await count(client, 'productos'), 0);
  assert.equal(await count(client, 'movimientos_inventario'), 0);
}));

test('GTIN con dígito de control inválido se rechaza antes de escribir', () => usingDatabase(async ({ client }) => {
  const raw = photoApproval() as unknown as Record<string, any>;
  raw.variante.gtin = '198480538029';
  raw.variante.longitudPieCm = null;
  delete raw.variante.longitudPieMm;
  assert.throws(() => parsePhotoApprovalPayload(raw), /GTIN no es válido/);
  assert.equal(await count(client, 'productos'), 0);
  assert.equal(await count(client, 'movimientos_inventario'), 0);
}));

test('fallo al insertar movimiento revierte producto, variante y nivel', () => usingDatabase(async ({ client }) => {
  await client.execute(`CREATE TRIGGER fallo_compra_fotos BEFORE INSERT ON movimientos_inventario
    WHEN NEW.clave_idempotencia LIKE 'alta-fotos:%' BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);
  await assert.rejects(approvePhotoInventory(photoApproval(), client), /fallo simulado/);
  assert.equal(await count(client, 'productos'), 0);
  assert.equal(await count(client, 'variantes_producto'), 0);
  assert.equal(await count(client, 'niveles_inventario'), 0);
  assert.equal(await count(client, 'movimientos_inventario'), 0);
}));

test('costes decimales 4,99 y 39,99 se convierten a céntimos enteros', () => {
  assert.equal(moneyToCents('4,99', 'Coste'), 499);
  assert.equal(moneyToCents('39,99', 'Coste'), 3999);
});

test('ropa guarda talla L sin longitud de pie y conserva tipo de prenda en metadata', () => usingDatabase(async ({ client }) => {
  await approvePhotoInventory(photoApproval({ type: 'ROPA', size: 'L', sizeSystem: 'ALFABETICO' }), client);
  const variant = await client.execute('SELECT etiqueta_talla, sistema_talla, longitud_pie_mm FROM variantes_producto');
  assert.equal(variant.rows[0].etiqueta_talla, 'L');
  assert.equal(variant.rows[0].sistema_talla, 'ALFABETICO');
  assert.equal(variant.rows[0].longitud_pie_mm, null);
  const movement = await client.execute('SELECT metadata_json FROM movimientos_inventario');
  assert.equal(JSON.parse(String(movement.rows[0].metadata_json)).tipo_prenda, 'Camiseta');
}));

test('calzado guarda talla 45 EU y longitud de pie 290 mm', () => usingDatabase(async ({ client }) => {
  await approvePhotoInventory(photoApproval({ type: 'CALZADO', size: '45', sizeSystem: 'EU', footLengthMm: 290 }), client);
  const variant = await client.execute('SELECT etiqueta_talla, sistema_talla, longitud_pie_mm FROM variantes_producto');
  assert.equal(variant.rows[0].etiqueta_talla, '45');
  assert.equal(variant.rows[0].sistema_talla, 'EU');
  assert.equal(Number(variant.rows[0].longitud_pie_mm), 290);
}));
