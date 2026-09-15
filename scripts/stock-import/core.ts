import { createHash } from 'node:crypto';

export const SYSTEMS_TALLA = [
  'EU',
  'US',
  'UK',
  'CM',
  'ALFABETICO',
  'EDAD',
  'ALTURA',
  'DESCONOCIDO'
] as const;

export type SistemaTalla = (typeof SYSTEMS_TALLA)[number];
export type TipoProducto = 'CALZADO' | 'ROPA' | 'ACCESORIO' | 'OTRO';

export interface ExcelRowData {
  marca: unknown;
  modelo: unknown;
  referencia: unknown;
  colorway: unknown;
  talla: unknown;
  sistemaTalla: unknown;
  unidades: unknown;
  pvp: unknown;
  precioOferta: unknown;
  coste: unknown;
  upc: unknown;
  upcFormatted?: string;
  factura: unknown;
  fechaCompra: unknown;
  proveedor: unknown;
  tipoProducto: unknown;
  genero: unknown;
  edad: unknown;
  ubicacion: unknown;
  notas: unknown;
}

export interface SourceRow {
  rowNumber: number;
  data: ExcelRowData;
}

export interface ImportWarning {
  code: 'UPC_VACIO' | 'UPC_MULTITALLA_AMBIGUO' | 'FACTURA_VACIA' | 'FECHA_COMPRA_VACIA' | 'COLORWAY_VACIO' | 'UNIDADES_MULTITALLA';
  rowNumber: number;
  message: string;
}

export interface ImportError {
  code: string;
  rowNumber?: number;
  message: string;
}

export interface ProductInput {
  key: string;
  marcaOriginal: string;
  marcaNormalizada: string;
  modelo: string;
  referenciaOriginal: string;
  referenciaNormalizada: string;
  colorwayOriginal: string | null;
  colorwayNormalizado: string | null;
  tituloCanonico: string;
  tipoProducto: TipoProducto;
}

export interface StockAllocation {
  rowNumber: number;
  allocationIndex: number;
  quantity: number;
  costCents: number | null;
  invoice: string | null;
  purchaseDateMs: number | null;
  supplier: string | null;
  notes: string | null;
  raw: Record<string, unknown>;
}

export interface VariantInput {
  key: string;
  productKey: string;
  title: string;
  barcode: string | null;
  originalSize: string;
  sizeSystem: SistemaTalla;
  sizeLabel: string;
  sizeThousandths: number | null;
  footLengthMm: number | null;
  ageGroup: 'BEBE' | 'INFANTIL' | 'ADULTO' | 'DESCONOCIDO';
  gender: 'UNISEX' | 'HOMBRE' | 'MUJER' | 'NINO' | 'NINA' | 'DESCONOCIDO';
  optionsSignature: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  locationName: string;
  locationCode: string;
  quantity: number;
  allocations: StockAllocation[];
}

export interface ImportAnalysis {
  physicalRows: number;
  realRows: number;
  ignoredTemplateRows: number;
  declaredUnits: number;
  resultingUnits: number;
  products: ProductInput[];
  variants: VariantInput[];
  warnings: ImportWarning[];
  errors: ImportError[];
}

export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

export function normalizeKey(value: unknown): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function normalizeProductReference(value: unknown): string {
  const normalized = normalizeText(value).toUpperCase().replace(/\s*-\s*/g, '-');
  const parts = normalized.split(/\s+/).filter(Boolean);
  return parts.length > 1 && parts.every((part) => /^[A-Z0-9]+$/.test(part))
    ? parts.join('-')
    : normalized;
}

export function normalizeReferenceForComparison(value: unknown): string | null {
  const normalized = normalizeText(value)
    .toUpperCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\s/\\\u2044\u2215\u2010-\u2015\u2212-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || null;
}

export function normalizeHeader(value: unknown): string {
  return normalizeKey(value).replace(/[^A-Z0-9]/g, '');
}

function parseLocalizedDecimal(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined || normalizeText(value) === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${fieldName} no es un número finito.`);
    return value;
  }

  let text = normalizeText(value).replace(/[€$£]/g, '').replace(/\s/g, '');
  if (!text) return null;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    text = text.replaceAll(thousandsSeparator, '').replace(decimalSeparator, '.');
  } else if (lastComma >= 0) {
    text = text.replace(',', '.');
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new Error(`${fieldName} no se puede interpretar: "${normalizeText(value)}".`);
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error(`${fieldName} no es un número finito.`);
  return parsed;
}

export function moneyToCents(value: unknown, fieldName = 'Importe'): number | null {
  const parsed = parseLocalizedDecimal(value, fieldName);
  if (parsed === null) return null;
  const cents = Math.round((parsed + Number.EPSILON) * 100);
  if (Math.abs(parsed * 100 - cents) > 1e-7) {
    throw new Error(`${fieldName} tiene más de dos decimales: "${normalizeText(value)}".`);
  }
  return cents;
}

export function barcodeToString(value: unknown, formatted?: string): string | null {
  if (value === null || value === undefined || normalizeText(value) === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) throw new Error('UPC numérico no entero.');
    if (!Number.isSafeInteger(value)) {
      const safeFormatted = normalizeText(formatted);
      if (/^\d+$/.test(safeFormatted)) return safeFormatted;
      throw new Error('UPC numérico fuera del rango seguro; conviértelo a texto en Excel.');
    }
    return value.toFixed(0);
  }

  const text = normalizeText(value);
  if (/^\d+\.0+$/.test(text)) return text.slice(0, text.indexOf('.'));
  if (/^\d+(?:\.\d+)?[eE][+]??\d+$/.test(text)) {
    const numeric = Number(text);
    if (Number.isSafeInteger(numeric)) return numeric.toFixed(0);
    throw new Error('UPC en notación científica fuera del rango seguro; conviértelo a texto en Excel.');
  }
  return text;
}

export interface GtinNormalizationResult {
  original: string | null;
  canonical: string | null;
  formatValid: boolean;
  checkDigitValid: boolean | null;
}

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

function gtinDigits(value: unknown, formatted?: string): { original: string | null; digits: string | null } {
  const original = barcodeToString(value, formatted);
  if (!original) return { original: null, digits: null };
  const withoutLabel = original.replace(/^\s*(?:GTIN(?:-1[2348])?|EAN(?:-8|-13)?|UPC(?:-A)?)\s*[:#]?\s*/i, '');
  const digits = withoutLabel.replace(/[\s-]/g, '');
  return { original, digits: /^\d+$/.test(digits) ? digits : null };
}

export function hasValidGtinCheckDigit(gtin: string): boolean {
  if (!GTIN_LENGTHS.has(gtin.length) || !/^\d+$/.test(gtin)) return false;
  const expected = gtin.charCodeAt(gtin.length - 1) - 48;
  let sum = 0;
  for (let index = gtin.length - 2, position = 0; index >= 0; index -= 1, position += 1) {
    sum += (gtin.charCodeAt(index) - 48) * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === expected;
}

export function inspectGtin(value: unknown, formatted?: string): GtinNormalizationResult {
  const { original, digits } = gtinDigits(value, formatted);
  if (!digits || !GTIN_LENGTHS.has(digits.length)) {
    return { original, canonical: null, formatValid: false, checkDigitValid: null };
  }
  return {
    original,
    canonical: digits.padStart(14, '0'),
    formatValid: true,
    checkDigitValid: hasValidGtinCheckDigit(digits)
  };
}

export function normalizeGtin(value: unknown, formatted?: string): string | null {
  return inspectGtin(value, formatted).canonical;
}

function parsePositiveInteger(value: unknown): number {
  const parsed = parseLocalizedDecimal(value, 'UNIDADES');
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('UNIDADES debe ser un entero mayor que cero.');
  }
  return parsed;
}

function normalizeSystem(value: unknown): SistemaTalla | null {
  const normalized = normalizeKey(value);
  if (normalized === 'ALFABETICO') return 'ALFABETICO';
  return SYSTEMS_TALLA.find((system) => system === normalized) ?? null;
}

function normalizeProductType(value: unknown): TipoProducto {
  const normalized = normalizeKey(value);
  if (normalized === 'CALZADO') return 'CALZADO';
  if (normalized === 'ROPA') return 'ROPA';
  if (normalized === 'ACCESORIO') return 'ACCESORIO';
  return 'OTRO';
}

function normalizeGender(value: unknown): VariantInput['gender'] {
  const normalized = normalizeKey(value);
  if (normalized === 'UNISEX') return 'UNISEX';
  if (normalized === 'HOMBRE') return 'HOMBRE';
  if (normalized === 'MUJER') return 'MUJER';
  if (normalized === 'NINO' || normalized === 'NIÑO') return 'NINO';
  if (normalized === 'NINA' || normalized === 'NIÑA') return 'NINA';
  return 'DESCONOCIDO';
}

function normalizeAge(value: unknown): VariantInput['ageGroup'] {
  const normalized = normalizeKey(value);
  if (normalized === 'BEBE' || normalized === 'BEBES') return 'BEBE';
  if (normalized === 'INFANTIL' || normalized === 'JUNIOR' || normalized === 'NINO' || normalized === 'NINA') return 'INFANTIL';
  if (normalized === 'ADULTO' || normalized === 'ADULTOS') return 'ADULTO';
  return 'DESCONOCIDO';
}

function parsePurchaseDate(value: unknown): number | null {
  if (value === null || value === undefined || normalizeText(value) === '') return null;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    if (!Number.isFinite(timestamp)) throw new Error('FECHA COMPRA no es válida.');
    return timestamp;
  }
  if (typeof value === 'number') {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return excelEpoch + Math.round(value * 86_400_000);
  }
  const parsed = Date.parse(normalizeText(value));
  if (!Number.isFinite(parsed)) throw new Error(`FECHA COMPRA no se puede interpretar: "${normalizeText(value)}".`);
  return parsed;
}

interface ParsedSize {
  label: string;
  thousandths: number | null;
  footLengthMm: number | null;
}

export function parseSize(value: unknown): ParsedSize {
  const original = normalizeText(value);
  const decimalNormalized = original.replace(/(?<=\d),(?=\d)/g, '.');
  const detailed = decimalNormalized.match(/^(\d+(?:\.\d+)?)\s*\(\s*(\d+(?:\.\d+)?)\s*cm\s*\)$/i);
  if (detailed) {
    return {
      label: `${detailed[1]} (${detailed[2]}cm)`,
      thousandths: Math.round(Number(detailed[1]) * 1000),
      footLengthMm: Math.round(Number(detailed[2]) * 10)
    };
  }
  const sized = decimalNormalized.match(/^(\d+(?:\.\d+)?)(\s+Y)?$/i);
  if (sized) {
    return {
      label: `${sized[1]}${sized[2] ? ' Y' : ''}`,
      thousandths: Math.round(Number(sized[1]) * 1000),
      footLengthMm: null
    };
  }
  return { label: decimalNormalized, thousandths: null, footLengthMm: null };
}

function productKey(data: ExcelRowData): string {
  return JSON.stringify([
    normalizeKey(data.marca),
    normalizeKey(data.modelo),
    normalizeKey(normalizeProductReference(data.referencia)),
    normalizeKey(data.colorway)
  ]);
}

function warning(code: ImportWarning['code'], rowNumber: number, message: string): ImportWarning {
  return { code, rowNumber, message };
}

function rawSnapshot(data: ExcelRowData): Record<string, unknown> {
  return {
    marca: data.marca,
    modelo: data.modelo,
    referencia: data.referencia,
    colorway: data.colorway,
    talla: data.talla,
    sistema_talla: data.sistemaTalla,
    unidades: data.unidades,
    pvp: data.pvp,
    precio_oferta: data.precioOferta,
    coste: data.coste,
    upc: barcodeToString(data.upc, data.upcFormatted),
    factura: data.factura,
    fecha_compra: data.fechaCompra instanceof Date ? data.fechaCompra.toISOString() : data.fechaCompra,
    proveedor: data.proveedor,
    tipo_producto: data.tipoProducto,
    genero: data.genero,
    edad: data.edad,
    ubicacion: data.ubicacion,
    notas: data.notas
  };
}

export function fingerprintAlreadyImported(fingerprint: string, importedFingerprints: Iterable<string>): boolean {
  return new Set(importedFingerprints).has(fingerprint);
}

export function analyzeRows(rows: SourceRow[], physicalRows = rows.length): ImportAnalysis {
  const products = new Map<string, ProductInput>();
  const variants = new Map<string, VariantInput>();
  const warnings: ImportWarning[] = [];
  const errors: ImportError[] = [];
  let realRows = 0;
  let ignoredTemplateRows = 0;
  let declaredUnits = 0;
  let resultingUnits = 0;

  for (const { rowNumber, data } of rows) {
    const marca = normalizeText(data.marca);
    const modelo = normalizeText(data.modelo);
    const referencia = normalizeProductReference(data.referencia);
    const originalSize = normalizeText(data.talla);
    if (!modelo && !referencia && !originalSize) {
      ignoredTemplateRows += 1;
      continue;
    }

    realRows += 1;
    const rowErrors: string[] = [];
    if (!marca) rowErrors.push('MARCA está vacía.');
    if (!modelo) rowErrors.push('MODELO está vacío.');
    if (!referencia) rowErrors.push('REFERENCIA está vacía.');
    if (!originalSize) rowErrors.push('TALLA está vacía.');
    const locationName = normalizeText(data.ubicacion);
    if (!locationName) rowErrors.push('UBICACIÓN está vacía.');
    const sizeSystem = normalizeSystem(data.sistemaTalla);
    if (!sizeSystem) rowErrors.push(`SISTEMA DE TALLA no válido: "${normalizeText(data.sistemaTalla)}".`);

    let units: number | null = null;
    let pvpCents: number | null = null;
    let offerCents: number | null = null;
    let costCents: number | null = null;
    let barcode: string | null = null;
    let purchaseDateMs: number | null = null;
    try { units = parsePositiveInteger(data.unidades); } catch (error) { rowErrors.push((error as Error).message); }
    try { pvpCents = moneyToCents(data.pvp, 'PVP'); } catch (error) { rowErrors.push((error as Error).message); }
    try { offerCents = moneyToCents(data.precioOferta, 'PRECIO OFERTA'); } catch (error) { rowErrors.push((error as Error).message); }
    try { costCents = moneyToCents(data.coste, 'COSTE'); } catch (error) { rowErrors.push((error as Error).message); }
    try { barcode = barcodeToString(data.upc, data.upcFormatted); } catch (error) { rowErrors.push((error as Error).message); }
    try { purchaseDateMs = parsePurchaseDate(data.fechaCompra); } catch (error) { rowErrors.push((error as Error).message); }
    if (pvpCents === null) rowErrors.push('PVP está vacío y precio_centimos es obligatorio.');
    if (pvpCents !== null && pvpCents < 0) rowErrors.push('PVP debe ser mayor o igual que cero.');
    if (offerCents !== null && offerCents < 0) rowErrors.push('PRECIO OFERTA debe ser mayor o igual que cero.');
    if (costCents !== null && costCents < 0) rowErrors.push('COSTE debe ser mayor o igual que cero.');

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => ({ code: 'FILA_INVALIDA', rowNumber, message })));
      continue;
    }

    const safeUnits = units as number;
    const safeSystem = sizeSystem as SistemaTalla;
    const safePvpCents = pvpCents as number;
    declaredUnits += safeUnits;
    const type = normalizeProductType(data.tipoProducto);
    const splitSizes = type === 'CALZADO' && originalSize.includes('/')
      ? [...new Set(originalSize.split('/').map(normalizeText).filter(Boolean).map((size) => parseSize(size).label))]
      : [parseSize(originalSize).label];
    if (splitSizes.some((size) => !size)) {
      errors.push({ code: 'TALLA_MULTIPLE_INVALIDA', rowNumber, message: 'TALLA contiene un separador sin una talla interpretable.' });
      continue;
    }
    const isMultiSizeFootwear = type === 'CALZADO' && splitSizes.length > 1;
    if (isMultiSizeFootwear && safeUnits !== splitSizes.length) {
      warnings.push(warning(
        'UNIDADES_MULTITALLA',
        rowNumber,
        'UNIDADES declaradas no coincide con número de tallas; se usa número de tallas.'
      ));
    }
    if (isMultiSizeFootwear && barcode) {
      warnings.push(warning(
        'UPC_MULTITALLA_AMBIGUO',
        rowNumber,
        'UPC único en fila multitalla; se conserva en raw pero no se asigna a variantes incompatibles.'
      ));
    }
    const rowResultingUnits = isMultiSizeFootwear ? splitSizes.length : safeUnits;
    resultingUnits += rowResultingUnits;

    const colorwayOriginal = normalizeText(data.colorway) || null;
    if (!barcode) warnings.push(warning('UPC_VACIO', rowNumber, 'UPC vacío.'));
    if (!normalizeText(data.factura)) warnings.push(warning('FACTURA_VACIA', rowNumber, 'Nº FACTURA vacío.'));
    if (!purchaseDateMs) warnings.push(warning('FECHA_COMPRA_VACIA', rowNumber, 'FECHA COMPRA vacía.'));
    if (!colorwayOriginal) warnings.push(warning('COLORWAY_VACIO', rowNumber, 'COLORWAY vacío.'));

    const pKey = productKey(data);
    if (!products.has(pKey)) {
      products.set(pKey, {
        key: pKey,
        marcaOriginal: marca,
        marcaNormalizada: normalizeKey(marca),
        modelo,
        referenciaOriginal: referencia,
        referenciaNormalizada: normalizeKey(referencia),
        colorwayOriginal,
        colorwayNormalizado: colorwayOriginal ? normalizeKey(colorwayOriginal) : null,
        tituloCanonico: [marca, modelo, colorwayOriginal].filter(Boolean).join(' - '),
        tipoProducto: type
      });
    }

    splitSizes.forEach((sizeLabel, allocationIndex) => {
      const parsedSize = parseSize(sizeLabel);
      const variantBarcode = isMultiSizeFootwear ? null : barcode;
      const optionsSignature = JSON.stringify({ sistema_talla: safeSystem, talla: parsedSize.label });
      const vKey = `${pKey}|${optionsSignature}`;
      const quantity = isMultiSizeFootwear ? 1 : safeUnits;
      const allocation: StockAllocation = {
        rowNumber,
        allocationIndex,
        quantity,
        costCents,
        invoice: normalizeText(data.factura) || null,
        purchaseDateMs,
        supplier: normalizeText(data.proveedor) || null,
        notes: normalizeText(data.notas) || null,
        raw: rawSnapshot(data)
      };
      const existing = variants.get(vKey);
      if (existing) {
        if (
          normalizeGtin(existing.barcode) !== normalizeGtin(variantBarcode) ||
          existing.priceCents !== (offerCents ?? safePvpCents) ||
          existing.compareAtPriceCents !== (offerCents === null ? null : safePvpCents) ||
          existing.locationCode !== normalizeKey(locationName).replace(/[^A-Z0-9]+/g, '_')
        ) {
          errors.push({
            code: 'VARIANTE_CONFLICTIVA',
            rowNumber,
            message: `La variante ${parsedSize.label}/${safeSystem} aparece repetida con datos incompatibles.`
          });
          return;
        }
        existing.quantity += quantity;
        existing.allocations.push(allocation);
        return;
      }

      variants.set(vKey, {
        key: vKey,
        productKey: pKey,
        title: `${parsedSize.label} ${safeSystem}`,
        barcode: variantBarcode,
        originalSize,
        sizeSystem: safeSystem,
        sizeLabel: parsedSize.label,
        sizeThousandths: parsedSize.thousandths,
        footLengthMm: parsedSize.footLengthMm,
        ageGroup: normalizeAge(data.edad),
        gender: normalizeGender(data.genero),
        optionsSignature,
        priceCents: offerCents ?? safePvpCents,
        compareAtPriceCents: offerCents === null ? null : safePvpCents,
        locationName,
        locationCode: normalizeKey(locationName).replace(/[^A-Z0-9]+/g, '_'),
        quantity,
        allocations: [allocation]
      });
    });
  }

  return {
    physicalRows,
    realRows,
    ignoredTemplateRows,
    declaredUnits,
    resultingUnits,
    products: [...products.values()],
    variants: [...variants.values()],
    warnings,
    errors
  };
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
