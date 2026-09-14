import { basename } from 'node:path';
import XLSX from 'xlsx';
import { normalizeHeader, type ExcelRowData, type SourceRow } from './core.ts';

const REQUIRED_COLUMNS = {
  MARCA: 'marca',
  MODELO: 'modelo',
  REFERENCIA: 'referencia',
  COLORWAY: 'colorway',
  TALLA: 'talla',
  SISTEMADETALLA: 'sistemaTalla',
  UNIDADES: 'unidades',
  PVP: 'pvp',
  PRECIOOFERTA: 'precioOferta',
  COSTE: 'coste',
  UPC: 'upc',
  NFACTURA: 'factura',
  FECHACOMPRA: 'fechaCompra',
  PROVEEDORCOMPRA: 'proveedor',
  TIPODEPRODUCTO: 'tipoProducto',
  GENERO: 'genero',
  EDAD: 'edad',
  UBICACION: 'ubicacion',
  NOTAS: 'notas'
} as const satisfies Record<string, keyof ExcelRowData>;

export interface LoadedWorkbook {
  fileName: string;
  sheetName: string;
  physicalRows: number;
  rows: SourceRow[];
}

export function loadWorkbook(filePath: string): LoadedWorkbook {
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: true });
  if (workbook.SheetNames.length !== 1) {
    throw new Error(`El Excel debe tener exactamente una hoja; contiene ${workbook.SheetNames.length}.`);
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet?.['!ref']) throw new Error('La hoja del Excel no tiene un rango de datos.');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const columns = new Map<keyof ExcelRowData, number>();

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })];
    const field = REQUIRED_COLUMNS[normalizeHeader(cell?.v) as keyof typeof REQUIRED_COLUMNS];
    if (field) columns.set(field, column);
  }
  const missing = Object.entries(REQUIRED_COLUMNS)
    .filter(([, field]) => !columns.has(field))
    .map(([header]) => header);
  if (missing.length > 0) throw new Error(`Faltan columnas obligatorias: ${missing.join(', ')}.`);

  const rows: SourceRow[] = [];
  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const read = (field: keyof ExcelRowData) => {
      const column = columns.get(field);
      return sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column as number })];
    };
    const upcCell = read('upc');
    rows.push({
      rowNumber: rowIndex + 1,
      data: {
        marca: read('marca')?.v ?? null,
        modelo: read('modelo')?.v ?? null,
        referencia: read('referencia')?.v ?? null,
        colorway: read('colorway')?.v ?? null,
        talla: read('talla')?.v ?? null,
        sistemaTalla: read('sistemaTalla')?.v ?? null,
        unidades: read('unidades')?.v ?? null,
        pvp: read('pvp')?.v ?? null,
        precioOferta: read('precioOferta')?.v ?? null,
        coste: read('coste')?.v ?? null,
        upc: upcCell?.v ?? null,
        upcFormatted: upcCell?.w,
        factura: read('factura')?.v ?? null,
        fechaCompra: read('fechaCompra')?.v ?? null,
        proveedor: read('proveedor')?.v ?? null,
        tipoProducto: read('tipoProducto')?.v ?? null,
        genero: read('genero')?.v ?? null,
        edad: read('edad')?.v ?? null,
        ubicacion: read('ubicacion')?.v ?? null,
        notas: read('notas')?.v ?? null
      }
    });
  }

  return {
    fileName: basename(filePath),
    sheetName,
    physicalRows: range.e.r - range.s.r,
    rows
  };
}
