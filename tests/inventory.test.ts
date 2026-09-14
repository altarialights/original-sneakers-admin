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
import { DuplicateProductError, DuplicateVariantError, InventoryError } from '../src/lib/inventory/errors.ts';
import { uuidV7 } from '../src/lib/inventory/ids.ts';
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
