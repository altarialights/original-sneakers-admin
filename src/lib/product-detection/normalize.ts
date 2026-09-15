import {
  barcodeToString,
  inspectGtin,
  normalizeGtin,
  normalizeReferenceForComparison,
  normalizeText,
  parseSize
} from '../inventory/normalization.ts';
import type {
  EvidenceSource,
  ModelProductDetection,
  NormalizedProductDetection,
  ReviewState
} from './schemas.ts';
import { modelProductDetectionSchema, normalizedProductDetectionSchema } from './schemas.ts';
import type { ProductKind } from './config.ts';

type FieldStatus = NormalizedProductDetection['estados'][string];
type SizeSystem = NonNullable<ModelProductDetection['variante']['sistemaTalla']>;
type SizeEquivalences = Partial<Record<SizeSystem, string>>;
type RawSizeRow = ModelProductDetection['observaciones']['caja']['filasTalla'][number];
type ProductGender = ModelProductDetection['producto']['genero'];
interface NormalizedSizeRow {
  etiqueta: string | null;
  genero: 'HOMBRE' | 'MUJER' | 'DESCONOCIDO';
  equivalencias: SizeEquivalences;
}

export const FOOTWEAR_SIZE_SYSTEM_PRIORITY = ['EU', 'US', 'UK', 'CM', 'BR'] as const satisfies readonly SizeSystem[];
type FootwearSizeSystem = (typeof FOOTWEAR_SIZE_SYSTEM_PRIORITY)[number];

function fieldStatus(
  value: string | number | null,
  evidence: EvidenceSource[],
  reviewReason?: string | null
): FieldStatus {
  if (value === null || value === '') {
    return { estado: 'NO_ENCONTRADO', evidencias: evidence, motivo: reviewReason || 'No se ha encontrado.' };
  }
  if (reviewReason) return { estado: 'REVISAR', evidencias: evidence, motivo: reviewReason };
  return {
    estado: evidence.length > 0 ? 'CONFIRMADO' : 'REVISAR',
    evidencias: evidence,
    motivo: evidence.length > 0 ? null : 'Comprueba este dato antes de aprobar.'
  };
}

export function normalizeBarcodeForComparison(value: unknown): string | null {
  return normalizeGtin(value);
}

function compareGtins(boxValue: unknown, shoeValue: unknown): { value: string | null; status: FieldStatus } {
  const box = inspectGtin(boxValue);
  const shoe = inspectGtin(shoeValue);
  const comparison = objectiveComparison(box.canonical, shoe.canonical, 'caja', 'etiqueta', 'El UPC / GTIN');
  const invalidFormat = [box, shoe].some((result) => result.original && !result.formatValid);
  if (invalidFormat) {
    comparison.status = {
      estado: 'REVISAR',
      evidencias: [box.original ? 'caja' : null, shoe.original ? 'etiqueta' : null].filter(Boolean) as EvidenceSource[],
      motivo: 'El UPC / GTIN detectado no tiene una longitud o formato GS1 válido.'
    };
  } else if (comparison.value && [box, shoe].some((result) => result.canonical && !result.checkDigitValid)) {
    comparison.status = {
      estado: 'REVISAR',
      evidencias: comparison.status.evidencias,
      motivo: 'El dígito de control del UPC / GTIN no es válido.'
    };
  }
  return comparison;
}

function normalizeDetectedSize(value: unknown, system: string | null): string | null {
  let text = normalizeText(value);
  if (!text) return null;
  if (system === 'EU') text = text.match(/(?:EUR?|EUROPA)\s*([0-9]+(?:[.,][0-9]+)?)/i)?.[1] ?? text;
  if (system === 'US') text = text.match(/US\s*([0-9]+(?:[.,][0-9]+)?)/i)?.[1] ?? text;
  if (system === 'UK') text = text.match(/UK\s*([0-9]+(?:[.,][0-9]+)?)/i)?.[1] ?? text;
  if (system === 'CM') text = text.match(/CM\s*([0-9]+(?:[.,][0-9]+)?)/i)?.[1] ?? text;
  if (system === 'EU') text = text.replace(/^(?:EUR?|EUROPA)\s*/i, '');
  if (system === 'US') text = text.replace(/^US\s*/i, '');
  if (system === 'UK') text = text.replace(/^UK\s*/i, '');
  const parsed = parseSize(text);
  if (system === 'CM' && parsed.thousandths !== null) return String(parsed.thousandths / 1000);
  return parsed.label || null;
}

function normalizedSizeSystem(value: string): SizeSystem | null {
  const normalized = value.toUpperCase();
  if (normalized === 'EUR' || normalized === 'EUROPA') return 'EU';
  if (['EU', 'US', 'UK', 'CM', 'BR', 'ALFABETICO', 'EDAD', 'ALTURA', 'DESCONOCIDO'].includes(normalized)) {
    return normalized as SizeSystem;
  }
  return null;
}

function extractSizeEquivalences(value: unknown, fallbackSystem: SizeSystem | null): SizeEquivalences {
  const text = normalizeText(value);
  if (!text) return {};
  const equivalences: SizeEquivalences = {};
  const expression = /(?:^|[\s/|;,])(?:EUR?|EUROPA|US|UK|CM|BR)\s*:?[\s]*([0-9]+(?:[.,][0-9]+)?)/gi;
  for (const match of text.matchAll(expression)) {
    const systemToken = match[0].match(/(?:EUR?|EUROPA|US|UK|CM|BR)/i)?.[0];
    const system = systemToken ? normalizedSizeSystem(systemToken) : null;
    const size = normalizeDetectedSize(match[1], system);
    if (system && size) equivalences[system] = size;
  }
  if (Object.keys(equivalences).length === 0 && fallbackSystem) {
    const size = normalizeDetectedSize(text, fallbackSystem);
    if (size) equivalences[fallbackSystem] = size;
  }
  return equivalences;
}

function normalizeSizeRow(row: RawSizeRow): NormalizedSizeRow | null {
  const equivalencias: SizeEquivalences = {};
  for (const system of FOOTWEAR_SIZE_SYSTEM_PRIORITY) {
    const size = normalizeDetectedSize(row[system], system);
    if (size) equivalencias[system] = size;
  }
  if (Object.keys(equivalencias).length === 0) return null;
  const label = normalizeText(row.etiqueta).toUpperCase() || null;
  const inferredGender = /\bWMNS\b|\bWOMEN'?S?\b|\bMUJER(?:ES)?\b/i.test(label ?? '')
    ? 'MUJER'
    : /\bMENS\b|\bMEN'?S?\b|\bHOMBRE(?:S)?\b/i.test(label ?? '')
      ? 'HOMBRE'
      : 'DESCONOCIDO';
  return {
    etiqueta: label,
    genero: row.genero === 'DESCONOCIDO' ? inferredGender : row.genero,
    equivalencias
  };
}

function rowsCompatible(first: NormalizedSizeRow, second: NormalizedSizeRow): boolean {
  const shared = FOOTWEAR_SIZE_SYSTEM_PRIORITY.filter((system) => first.equivalencias[system] && second.equivalencias[system]);
  return shared.length > 0 && shared.every((system) => first.equivalencias[system] === second.equivalencias[system]);
}

function targetSizeRowGender(gender: ProductGender): NormalizedSizeRow['genero'] | null {
  if (gender === 'HOMBRE') return 'HOMBRE';
  if (gender === 'MUJER') return 'MUJER';
  return null;
}

function commonRowEquivalences(rows: NormalizedSizeRow[]): SizeEquivalences {
  if (rows.length === 0) return {};
  return Object.fromEntries(FOOTWEAR_SIZE_SYSTEM_PRIORITY.flatMap((system) => {
    const values = rows.map((row) => row.equivalencias[system]);
    return values.every((value) => value && value === values[0]) ? [[system, values[0]]] : [];
  })) as SizeEquivalences;
}

function chooseSizeRow(
  rows: NormalizedSizeRow[],
  gender: ProductGender,
  counterpart: NormalizedSizeRow | null
): NormalizedSizeRow | null {
  if (rows.length === 0) return null;
  const targetGender = targetSizeRowGender(gender);
  if (targetGender) {
    const matches = rows.filter((row) => row.genero === targetGender);
    if (matches.length === 1) return matches[0];
  }
  if (rows.length === 1) return rows[0];
  if (counterpart) {
    const matches = rows.filter((row) => rowsCompatible(row, counterpart));
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export function selectPrimaryFootwearSize(
  boxValue: unknown,
  labelValue: unknown,
  fallbackSystem: SizeSystem | null,
  boxRawRows: RawSizeRow[] = [],
  labelRawRows: RawSizeRow[] = [],
  productGender: ProductGender = null
): {
  system: SizeSystem | null;
  boxSize: string | null;
  labelSize: string | null;
  equivalences: SizeEquivalences;
  rows: NormalizedSizeRow[];
  ambiguous: boolean;
} {
  const structuredBoxRows = boxRawRows.map(normalizeSizeRow).filter(Boolean) as NormalizedSizeRow[];
  const structuredLabelRows = labelRawRows.map(normalizeSizeRow).filter(Boolean) as NormalizedSizeRow[];
  const flatBoxRow: NormalizedSizeRow = {
    etiqueta: null, genero: 'DESCONOCIDO', equivalencias: extractSizeEquivalences(boxValue, fallbackSystem)
  };
  const flatLabelRow: NormalizedSizeRow = {
    etiqueta: null, genero: 'DESCONOCIDO', equivalencias: extractSizeEquivalences(labelValue, fallbackSystem)
  };
  const boxRows = structuredBoxRows.length > 0 ? structuredBoxRows : [flatBoxRow];
  const labelRows = structuredLabelRows.length > 0 ? structuredLabelRows : [flatLabelRow];
  let selectedBox = chooseSizeRow(boxRows, productGender, labelRows.length === 1 ? labelRows[0] : null);
  let selectedLabel = chooseSizeRow(labelRows, productGender, selectedBox);
  if (!selectedBox && selectedLabel) selectedBox = chooseSizeRow(boxRows, productGender, selectedLabel);
  if (!selectedLabel && selectedBox) selectedLabel = chooseSizeRow(labelRows, productGender, selectedBox);
  const ambiguous = !selectedBox || !selectedLabel || !rowsCompatible(selectedBox, selectedLabel);
  const allRows = [...structuredBoxRows, ...structuredLabelRows];
  const rows = [...new Map(allRows.map((row) => [JSON.stringify(row), row])).values()];
  const box = selectedBox?.equivalencias ?? commonRowEquivalences(boxRows);
  const label = selectedLabel?.equivalencias ?? commonRowEquivalences(labelRows);
  const availableSystems = [...new Set([...Object.keys(box), ...Object.keys(label)])] as SizeSystem[];
  const orderedSystems = [
    ...FOOTWEAR_SIZE_SYSTEM_PRIORITY,
    ...availableSystems.filter((system) => !FOOTWEAR_SIZE_SYSTEM_PRIORITY.includes(system as FootwearSizeSystem))
  ];
  const confirmedSystem = orderedSystems.find((system) => box[system] && box[system] === label[system]);
  const system = confirmedSystem ?? orderedSystems.find((candidate) => box[candidate] || label[candidate]) ?? null;
  const equivalences = Object.fromEntries(availableSystems.map((candidate) => [
    candidate,
    box[candidate] === label[candidate] ? box[candidate] : box[candidate] ?? label[candidate]
  ]).filter((entry): entry is [SizeSystem, string] => Boolean(entry[1]))) as SizeEquivalences;
  return {
    system,
    boxSize: system ? box[system] ?? null : null,
    labelSize: system ? label[system] ?? null : null,
    equivalences,
    rows,
    ambiguous
  };
}

function objectiveComparison(
  first: string | null,
  second: string | null,
  firstSource: EvidenceSource,
  secondSource: EvidenceSource,
  label: string
): { value: string | null; status: FieldStatus } {
  const evidence = [first ? firstSource : null, second ? secondSource : null].filter(Boolean) as EvidenceSource[];
  if (first && second && first === second) {
    return { value: first, status: { estado: 'CONFIRMADO', evidencias: evidence, motivo: null } };
  }
  if (first && second && first !== second) {
    return {
      value: first,
      status: { estado: 'REVISAR', evidencias: evidence, motivo: `${label} no coincide entre caja y etiqueta.` }
    };
  }
  const value = first || second;
  return {
    value,
    status: fieldStatus(value, evidence, value ? `Solo hemos encontrado ${label.toLowerCase()} en una foto.` : null)
  };
}

function compareReferences(
  aggregateValue: string | null,
  boxValue: string | null,
  labelValue: string | null
): { value: string | null; status: FieldStatus } {
  const comparison = objectiveComparison(boxValue, labelValue, 'caja', 'etiqueta', 'La referencia');
  if (!boxValue || !labelValue || boxValue === labelValue) return comparison;
  const boxDigits = boxValue.replace(/\D/g, '');
  const labelDigits = labelValue.replace(/\D/g, '');
  const boxLength = boxValue.replace(/[^A-Z0-9]/g, '').length;
  const labelLength = labelValue.replace(/[^A-Z0-9]/g, '').length;
  const sameNumericIdentity = Boolean(boxDigits) && boxDigits === labelDigits;
  const moreCompleteValue = sameNumericIdentity && boxLength !== labelLength
    ? (boxLength > labelLength ? boxValue : labelValue)
    : null;
  const selectedValue = moreCompleteValue
    ?? (aggregateValue === boxValue || aggregateValue === labelValue ? aggregateValue : null);
  if (selectedValue) {
    const matchingSource: EvidenceSource = selectedValue === boxValue ? 'caja' : 'etiqueta';
    const doubtfulSource = matchingSource === 'caja' ? 'etiqueta' : 'caja';
    return {
      value: selectedValue,
      status: {
        estado: 'REVISAR',
        evidencias: [matchingSource],
        motivo: `La lectura de ${doubtfulSource} no coincide; se ha conservado la referencia más completa respaldada por las evidencias.`
      }
    };
  }
  return comparison;
}

function validDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeCanonicalModel(
  brandValue: unknown,
  modelValue: unknown,
  detectedGender: ProductGender
): { model: string | null; gender: ProductGender; genderInferredFromModel: boolean } {
  const brand = normalizeText(brandValue);
  const rawModel = normalizeText(modelValue);
  if (!brand || !rawModel) {
    return { model: rawModel || null, gender: detectedGender, genderInferredFromModel: false };
  }

  const brandPattern = brand.split(/\s+/).map(escapeRegularExpression).join('\\s+');
  const genderAndBrand = rawModel.match(
    new RegExp(`^(W|WMNS|WOMENS|M|MENS)\\s+${brandPattern}(?:\\s+|$)`, 'i')
  );
  let canonicalModel = rawModel;
  let prefixGender: ProductGender = null;

  if (genderAndBrand) {
    const prefix = genderAndBrand[1].toUpperCase();
    prefixGender = ['W', 'WMNS', 'WOMENS'].includes(prefix) ? 'MUJER' : 'HOMBRE';
    canonicalModel = rawModel.slice(genderAndBrand[0].length).trim();
  } else {
    const duplicatedBrand = rawModel.match(new RegExp(`^${brandPattern}(?:\\s+|$)`, 'i'));
    if (duplicatedBrand) canonicalModel = rawModel.slice(duplicatedBrand[0].length).trim();
  }

  const genderInferredFromModel = Boolean(
    prefixGender && (detectedGender === null || detectedGender === 'DESCONOCIDO')
  );
  return {
    model: canonicalModel || null,
    gender: genderInferredFromModel ? prefixGender : detectedGender,
    genderInferredFromModel
  };
}

export function normalizeCanonicalClothingModel(
  brandValue: unknown,
  modelValue: unknown,
  detectedGender: ProductGender
): { model: string | null; gender: ProductGender; genderInferredFromModel: boolean } {
  const brand = normalizeText(brandValue);
  const rawModel = normalizeText(modelValue);
  if (!rawModel) return { model: null, gender: detectedGender, genderInferredFromModel: false };

  const genderPrefix = rawModel.match(/^(M|MEN|MENS|W|WMNS|WOMENS)\s+(?=\S)/i);
  let modelWithoutGender = rawModel;
  let gender = detectedGender;
  let genderInferredFromModel = false;
  if (genderPrefix) {
    const prefix = genderPrefix[1].toUpperCase();
    const prefixGender: ProductGender = ['W', 'WMNS', 'WOMENS'].includes(prefix) ? 'MUJER' : 'HOMBRE';
    const genderMatchesContext = detectedGender === prefixGender
      || detectedGender === null
      || detectedGender === 'DESCONOCIDO';
    if (genderMatchesContext) {
      modelWithoutGender = rawModel.slice(genderPrefix[0].length).trim();
      if (detectedGender === null || detectedGender === 'DESCONOCIDO') {
        gender = prefixGender;
        genderInferredFromModel = true;
      }
    }
  }

  const withoutDuplicatedBrand = normalizeCanonicalModel(brand, modelWithoutGender, gender);
  let canonicalModel = withoutDuplicatedBrand.model;
  if (brand.toUpperCase() === 'NIKE' && canonicalModel) {
    canonicalModel = canonicalModel.replace(/^NSW(?:\s+SW)?(?:\s+|$)/i, '').trim() || null;
  }
  return { model: canonicalModel, gender, genderInferredFromModel };
}

export function reconcileProductDetection(input: ModelProductDetection, productKind: ProductKind = 'CALZADO'): NormalizedProductDetection {
  const model = modelProductDetectionSchema.parse(input);
  const productReference = normalizeReferenceForComparison(model.producto.referencia);
  const boxReference = normalizeReferenceForComparison(model.observaciones.caja.referencia);
  const shoeReference = normalizeReferenceForComparison(model.observaciones.etiqueta.referencia);
  const referenceComparison = compareReferences(productReference, boxReference, shoeReference);
  if (process.env.NODE_ENV === 'development') {
    console.info('[product-detection] reference comparison', JSON.stringify({
      rawBox: model.observaciones.caja.referencia,
      rawLabel: model.observaciones.etiqueta.referencia,
      normalizedBox: boxReference,
      normalizedLabel: shoeReference,
      aggregateValue: productReference,
      finalValue: referenceComparison.value || productReference,
      status: referenceComparison.status.estado,
      evidence: referenceComparison.status.evidencias
    }));
  }

  let sizeSystem = model.variante.sistemaTalla;
  let sizeEquivalences: SizeEquivalences = {};
  let sizeRows: NormalizedSizeRow[] = [];
  let sizeRowsAmbiguous = false;
  let boxSize = normalizeDetectedSize(model.observaciones.caja.talla, sizeSystem);
  let shoeSize = normalizeDetectedSize(model.observaciones.etiqueta.talla, sizeSystem);
  if (productKind === 'CALZADO') {
    const footwearSize = selectPrimaryFootwearSize(
      model.observaciones.caja.talla,
      model.observaciones.etiqueta.talla,
      sizeSystem,
      model.observaciones.caja.filasTalla,
      model.observaciones.etiqueta.filasTalla,
      model.producto.genero
    );
    sizeSystem = footwearSize.system;
    sizeEquivalences = footwearSize.equivalences;
    sizeRows = footwearSize.rows;
    sizeRowsAmbiguous = footwearSize.ambiguous;
    boxSize = footwearSize.boxSize;
    shoeSize = footwearSize.labelSize;
  }
  const sizeComparison = objectiveComparison(boxSize, shoeSize, 'caja', 'etiqueta', 'La talla');
  if (productKind === 'CALZADO' && sizeRowsAmbiguous) {
    sizeComparison.status = {
      estado: 'REVISAR',
      evidencias: sizeComparison.status.evidencias,
      motivo: 'Hay varias filas de equivalencias y no se puede determinar cuál corresponde a esta variante sin mezclar tallas.'
    };
  }

  const boxGtinInput = inspectGtin(model.observaciones.caja.upc).canonical
    ? model.observaciones.caja.upc
    : model.observaciones.caja.barcodeDigits;
  const boxGtin = inspectGtin(boxGtinInput);
  const shoeGtin = inspectGtin(model.observaciones.etiqueta.upc);
  const upcComparison = compareGtins(boxGtinInput, model.observaciones.etiqueta.upc);
  if (productKind === 'ROPA') {
    referenceComparison.value = boxReference || productReference;
    referenceComparison.status = fieldStatus(referenceComparison.value, boxReference ? ['etiquetaRopa'] : [], null);
    sizeComparison.value = boxSize || normalizeDetectedSize(model.variante.tallaOriginal, sizeSystem);
    sizeComparison.status = fieldStatus(sizeComparison.value, boxSize ? ['etiquetaRopa'] : [], null);
    if (boxGtin.canonical) {
      upcComparison.value = boxGtin.canonical;
      upcComparison.status = boxGtin.checkDigitValid
        ? { estado: 'CONFIRMADO', evidencias: ['etiquetaRopa'], motivo: null }
        : { estado: 'REVISAR', evidencias: ['etiquetaRopa'], motivo: 'El dígito de control del UPC / GTIN no es válido.' };
    }
  }

  const ticketMatches = upcComparison.value
    ? model.ticket.lineas.filter((line) => normalizeBarcodeForComparison(line.codigo) === upcComparison.value)
    : [];
  if (process.env.NODE_ENV === 'development') {
    const ticketCodes = model.ticket.lineas.map((line) => barcodeToString(line.codigo)).filter(Boolean);
    console.info(
      `[product-detection] ticket candidates codes=${JSON.stringify(ticketCodes)} codigoMatched=${ticketMatches.length > 0 ? upcComparison.value : null} precioFinalMatched=${ticketMatches.length === 1 ? ticketMatches[0].precioFinalCentimos : null}`
    );
    console.info('[product-detection] gtin comparison', JSON.stringify({
      rawBox: barcodeToString(boxGtinInput),
      rawLabel: barcodeToString(model.observaciones.etiqueta.upc),
      canonicalBox: boxGtin.canonical,
      canonicalLabel: shoeGtin.canonical,
      canonicalTicket: model.ticket.lineas.map((line) => normalizeBarcodeForComparison(line.codigo)).filter(Boolean),
      finalValue: upcComparison.value,
      statusBeforeTicket: upcComparison.status.estado
    }));
  }
  const onlyOnePhotoHasReadableGtin = Boolean(boxGtin.canonical && !shoeGtin.original)
    || Boolean(shoeGtin.canonical && !boxGtin.original);
  if (
    productKind === 'CALZADO'
    && upcComparison.status.estado === 'REVISAR'
    && onlyOnePhotoHasReadableGtin
    && ticketMatches.length > 0
    && (boxGtin.checkDigitValid === true || shoeGtin.checkDigitValid === true)
  ) {
    upcComparison.status = {
      estado: 'CONFIRMADO',
      evidencias: [boxGtin.canonical ? 'caja' : 'etiqueta', 'ticket'],
      motivo: null
    };
  }
  if (ticketMatches.length > 0 && upcComparison.status.estado === 'CONFIRMADO') {
    upcComparison.status.evidencias = [...new Set<EvidenceSource>([...upcComparison.status.evidencias, 'ticket'])];
  }

  let costCents: number | null = null;
  let costState: FieldStatus = {
    estado: 'NO_ENCONTRADO',
    evidencias: [],
    motivo: 'El UPC no aparece de forma inequívoca en el ticket.'
  };
  if (upcComparison.value && upcComparison.status.estado !== 'REVISAR') {
    const matches = ticketMatches;
    if (matches.length === 1 && matches[0].precioFinalCentimos !== null) {
      console.info('[gtin-match] canonical match found');
      costCents = matches[0].precioFinalCentimos;
      costState = { estado: 'CONFIRMADO', evidencias: ['ticket'], motivo: null };
    } else if (matches.length > 1) {
      const prices = [...new Set(matches.map((line) => line.precioFinalCentimos))];
      if (prices.length === 1 && prices[0] !== null) {
        costCents = prices[0];
        costState = { estado: 'CONFIRMADO', evidencias: ['ticket'], motivo: null };
        console.info('[gtin-match] canonical match found');
      } else {
        costState = { estado: 'REVISAR', evidencias: ['ticket'], motivo: 'El UPC aparece con precios distintos en el ticket.' };
      }
    }
  }

  const marca = normalizeText(model.producto.marca) || null;
  const canonicalModel = productKind === 'ROPA'
    ? normalizeCanonicalClothingModel(marca, model.producto.modelo, model.producto.genero)
    : normalizeCanonicalModel(marca, model.producto.modelo, model.producto.genero);
  const modelo = canonicalModel.model;
  const genero = canonicalModel.gender;
  const genderEvidence = canonicalModel.genderInferredFromModel
    ? [...new Set<EvidenceSource>([...model.evidencias.genero, ...model.evidencias.modelo])]
    : model.evidencias.genero;
  const colorway = normalizeText(model.producto.colorway) || null;
  const provider = normalizeText(model.ticket.proveedor) || null;
  const purchaseDate = validDate(model.ticket.fechaOrigenCompra) || validDate(model.ticket.fechaCompra);
  const operationDate = validDate(model.ticket.fechaOperacion);
  if (process.env.NODE_ENV === 'development') {
    console.info('[product-detection] date selection', JSON.stringify({
      fechaOrigenCompra: model.ticket.fechaOrigenCompra,
      fechaOperacion: model.ticket.fechaOperacion,
      fechaGeneral: model.ticket.fechaCompra,
      fechaFinalElegida: purchaseDate
    }));
  }
  const reference = referenceComparison.value || productReference;
  const normalizedSize = sizeComparison.value || normalizeDetectedSize(model.variante.tallaOriginal, sizeSystem);
  const fallbackGtin = inspectGtin(model.variante.upc);
  const gtinNormalizado = upcComparison.value || fallbackGtin.canonical;
  const matchingOriginal = boxGtin.canonical === gtinNormalizado
    ? boxGtin.original
    : shoeGtin.canonical === gtinNormalizado
      ? shoeGtin.original
      : fallbackGtin.original;
  const upc = matchingOriginal ? barcodeToString(matchingOriginal) : null;
  const gtinCheckDigitValido = gtinNormalizado
    ? (boxGtin.canonical === gtinNormalizado ? boxGtin.checkDigitValid
      : shoeGtin.canonical === gtinNormalizado ? shoeGtin.checkDigitValid
        : fallbackGtin.checkDigitValid)
    : null;
  const result: NormalizedProductDetection = {
    productKind,
    imagenes: productKind === 'CALZADO'
      ? model.imagenes
      : { etiquetaRopa: model.imagenes.caja, ticket: model.imagenes.ticket, prendaCompleta: model.imagenes.etiqueta },
    producto: {
      marca,
      modelo,
      referencia: reference,
      colorway,
      subtipo: normalizeText(model.producto.subtipo) || null,
      tipoProducto: productKind,
      genero
    },
    variante: {
      tallaOriginal: normalizeText(model.variante.tallaOriginal) || null,
      tallaNormalizada: normalizedSize,
      sistemaTalla: sizeSystem,
      equivalenciasTalla: sizeEquivalences,
      filasEquivalenciasTalla: sizeRows,
      upc,
      gtinNormalizado,
      gtinCheckDigitValido,
      cantidad: model.variante.cantidad ?? 1
    },
    compra: { costeCentimos: costCents, proveedor: provider, fechaCompra: purchaseDate },
    ticket: { lineas: model.ticket.lineas, fechaOperacion: operationDate },
    estados: {
      marca: fieldStatus(marca, model.evidencias.marca),
      modelo: fieldStatus(modelo, model.evidencias.modelo),
      referencia: referenceComparison.value
        ? referenceComparison.status
        : fieldStatus(reference, [], reference ? 'Comprueba la referencia antes de aprobar.' : null),
      colorway: fieldStatus(colorway, model.evidencias.colorway),
      subtipo: fieldStatus(normalizeText(model.producto.subtipo) || null, productKind === 'ROPA' ? model.evidencias.tipoProducto : []),
      tipoProducto: { estado: 'CONFIRMADO', evidencias: model.evidencias.tipoProducto, motivo: null },
      genero: fieldStatus(genero, genderEvidence),
      talla: sizeComparison.value
        ? sizeComparison.status
        : fieldStatus(normalizedSize, [], normalizedSize ? 'Comprueba la talla antes de aprobar.' : null),
      sistemaTalla: fieldStatus(sizeSystem, model.evidencias.sistemaTalla),
      upc: boxGtin.original || shoeGtin.original
        ? upcComparison.status
        : fieldStatus(upc, [], upc ? 'Comprueba el UPC antes de aprobar.' : null),
      coste: costState,
      proveedor: fieldStatus(provider, model.evidencias.proveedor),
      fechaCompra: fieldStatus(purchaseDate, model.evidencias.fechaCompra)
    }
  };
  return normalizedProductDetectionSchema.parse(result);
}

export function reviewStateForPair(first: string | null, second: string | null): ReviewState {
  if (!first && !second) return 'NO_ENCONTRADO';
  return first && second && first === second ? 'CONFIRMADO' : 'REVISAR';
}
