import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createClient } from '@libsql/client';
import { commitImport } from '../scripts/importar-stock-inicial.ts';
import {
  analyzeRows,
  barcodeToString,
  fingerprintAlreadyImported,
  moneyToCents,
  parseSize,
  type ExcelRowData
} from '../scripts/stock-import/core.ts';

function row(overrides: Partial<ExcelRowData> = {}): ExcelRowData {
  return {
    marca: 'Nike',
    modelo: 'Air Test',
    referencia: 'TEST-001',
    colorway: 'Blanco',
    talla: '42',
    sistemaTalla: 'EU',
    unidades: 1,
    pvp: 99.99,
    precioOferta: 79.9,
    coste: 40,
    upc: 123456789012,
    factura: 'F-1',
    fechaCompra: new Date('2026-01-01T00:00:00.000Z'),
    proveedor: 'Proveedor',
    tipoProducto: 'Calzado',
    genero: 'Unisex',
    edad: 'Adultos',
    ubicacion: 'Tienda',
    notas: null,
    ...overrides
  };
}

function analyze(data: ExcelRowData) {
  return analyzeRows([{ rowNumber: 2, data }], 999);
}

test('fila normal conserva UNIDADES y produce una variante', () => {
  const result = analyze(row({ unidades: 2 }));
  assert.equal(result.realRows, 1);
  assert.equal(result.variants.length, 1);
  assert.equal(result.declaredUnits, 2);
  assert.equal(result.resultingUnits, 2);
  assert.equal(result.variants[0].quantity, 2);
  assert.deepEqual(result.errors, []);
});

test('multitalla de calzado con unidades correctas crea una variante por talla', () => {
  const result = analyze(row({ talla: '41/42/44/45', unidades: 4 }));
  assert.deepEqual(result.variants.map((variant) => variant.sizeLabel), ['41', '42', '44', '45']);
  assert.equal(result.resultingUnits, 4);
  assert.equal(result.warnings.some((item) => item.code === 'UNIDADES_MULTITALLA'), false);
  assert.equal(result.warnings.filter((item) => item.code === 'UPC_MULTITALLA_AMBIGUO').length, 1);
  assert.ok(result.variants.every((variant) => variant.barcode === null));
  assert.ok(result.variants.every((variant) => variant.allocations[0].raw.upc === '123456789012'));
});

test('multitalla de calzado prevalece sobre UNIDADES=1 y avisa', () => {
  const result = analyze(row({ talla: '37.5/38/39', unidades: 1 }));
  assert.equal(result.variants.length, 3);
  assert.equal(result.declaredUnits, 1);
  assert.equal(result.resultingUnits, 3);
  assert.equal(result.warnings.filter((item) => item.code === 'UNIDADES_MULTITALLA').length, 1);
  assert.ok(result.variants.every((variant) => variant.quantity === 1));
});

test('talla comercial de ropa XS/S no se divide', () => {
  const result = analyze(row({ talla: 'XS/S', unidades: 2, tipoProducto: 'Ropa', sistemaTalla: 'ALFABÉTICO' }));
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].sizeLabel, 'XS/S');
  assert.equal(result.variants[0].quantity, 2);
});

test('decimal 37,5 se normaliza con precisión y conserva el original', () => {
  const result = analyze(row({ talla: '37,5' }));
  assert.equal(result.variants[0].originalSize, '37,5');
  assert.equal(result.variants[0].sizeLabel, '37.5');
  assert.equal(result.variants[0].sizeThousandths, 37_500);
  assert.deepEqual(parseSize('37,5 (23,5cm)'), {
    label: '37.5 (23.5cm)',
    thousandths: 37_500,
    footLengthMm: 235
  });
});

test('talla Y conserva el sufijo', () => {
  const result = analyze(row({ talla: '35.5 Y' }));
  assert.equal(result.variants[0].sizeLabel, '35.5 Y');
  assert.equal(result.variants[0].sizeThousandths, 35_500);
});

test('UPC numérico se convierte a string sin .0 ni notación científica', () => {
  assert.equal(barcodeToString(197601045544), '197601045544');
  assert.equal(barcodeToString('197601045544.0'), '197601045544');
});

test('fila vacía con defaults se ignora', () => {
  const result = analyze(row({ modelo: null, referencia: null, talla: null, unidades: 1, sistemaTalla: 'EU' }));
  assert.equal(result.realRows, 0);
  assert.equal(result.ignoredTemplateRows, 1);
  assert.equal(result.products.length, 0);
  assert.equal(result.errors.length, 0);
});

test('dinero se convierte a céntimos enteros de forma segura', () => {
  assert.equal(moneyToCents(99.99), 9_999);
  assert.equal(moneyToCents('99,90'), 9_990);
  assert.equal(moneyToCents('1.234,56'), 123_456);
});

test('fingerprint ya registrado bloquea una importación duplicada', async () => {
  const fingerprint = 'a'.repeat(64);
  assert.equal(fingerprintAlreadyImported(fingerprint, [fingerprint]), true);
  assert.equal(fingerprintAlreadyImported(fingerprint, ['b'.repeat(64)]), false);

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'original-sneakers-stock-test-'));
  const databasePath = join(temporaryDirectory, 'stock.sqlite').replaceAll('\\', '/');
  const client = createClient({ url: `file:${databasePath}`, intMode: 'number' });
  try {
    await client.executeMultiple(await readFile(new URL('../migrations/001_inicial.sql', import.meta.url), 'utf8'));
    const result = analyze(row());
    await commitImport(client, result, fingerprint, 'stock-test.xlsx', 'Hoja 1');
    await assert.rejects(
      commitImport(client, result, fingerprint, 'stock-test.xlsx', 'Hoja 1'),
      /ya fue importado/
    );
    for (const [table, expected] of [
      ['productos', 1],
      ['variantes_producto', 1],
      ['niveles_inventario', 1],
      ['movimientos_inventario', 1],
      ['ejecuciones_sincronizacion', 1],
      ['registros_externos_raw', 1]
    ] as const) {
      const count = await client.execute(`SELECT COUNT(*) AS total FROM ${table}`);
      assert.equal(Number(count.rows[0]?.total), expected, `conteo inesperado en ${table}`);
    }
  } finally {
    client.close();
    (globalThis as { gc?: () => void }).gc?.();
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
