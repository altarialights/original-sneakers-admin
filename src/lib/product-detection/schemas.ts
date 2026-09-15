import { z } from 'zod';
import {
  SOURCE_DATA_IMAGE_KINDS,
  PRODUCT_KINDS,
  type GenerationReferenceImageKind,
  type ProductImageKind,
  type SourceDataImageKind
} from './config.ts';

export const reviewStateSchema = z.enum(['CONFIRMADO', 'REVISAR', 'NO_ENCONTRADO']);
export const evidenceSourceSchema = z.enum(SOURCE_DATA_IMAGE_KINDS);

const nullableText = z.string().nullable();
export const productKindSchema = z.enum(PRODUCT_KINDS);
const imageUsabilitySchema = z.object({
  usable: z.boolean(),
  motivo: nullableText
});

const ticketLineSchema = z.object({
  descripcion: nullableText,
  codigo: nullableText,
  precioOriginalCentimos: z.number().int().nonnegative().nullable(),
  descuentoCentimos: z.number().int().nonnegative().nullable(),
  precioFinalCentimos: z.number().int().nonnegative().nullable()
});

const sizeEquivalenceRowSchema = z.object({
  etiqueta: nullableText,
  genero: z.enum(['HOMBRE', 'MUJER', 'DESCONOCIDO']),
  EU: nullableText,
  US: nullableText,
  UK: nullableText,
  CM: nullableText,
  BR: nullableText
});

const observationSchema = z.object({
  referencia: nullableText,
  talla: nullableText,
  filasTalla: z.array(sizeEquivalenceRowSchema),
  upc: nullableText,
  barcodeDigits: nullableText
});

export const modelProductDetectionSchema = z.object({
  imagenes: z.object({
    caja: imageUsabilitySchema,
    ticket: imageUsabilitySchema,
    etiqueta: imageUsabilitySchema
  }),
  producto: z.object({
    marca: nullableText,
    modelo: nullableText,
    referencia: nullableText,
    colorway: nullableText,
    subtipo: nullableText,
    tipoProducto: z.enum(['CALZADO', 'ROPA', 'ACCESORIO', 'OTRO']).nullable(),
    genero: z.enum(['UNISEX', 'HOMBRE', 'MUJER', 'NINO', 'NINA', 'DESCONOCIDO']).nullable()
  }),
  variante: z.object({
    tallaOriginal: nullableText,
    sistemaTalla: z.enum(['EU', 'US', 'UK', 'CM', 'BR', 'ALFABETICO', 'EDAD', 'ALTURA', 'DESCONOCIDO']).nullable(),
    upc: nullableText,
    cantidad: z.number().int().positive().nullable()
  }),
  ticket: z.object({
    proveedor: nullableText,
    fechaCompra: nullableText,
    fechaOrigenCompra: nullableText,
    fechaOperacion: nullableText,
    lineas: z.array(ticketLineSchema)
  }),
  evidencias: z.object({
    marca: z.array(evidenceSourceSchema),
    modelo: z.array(evidenceSourceSchema),
    referencia: z.array(evidenceSourceSchema),
    colorway: z.array(evidenceSourceSchema),
    tipoProducto: z.array(evidenceSourceSchema),
    genero: z.array(evidenceSourceSchema),
    talla: z.array(evidenceSourceSchema),
    sistemaTalla: z.array(evidenceSourceSchema),
    upc: z.array(evidenceSourceSchema),
    proveedor: z.array(evidenceSourceSchema),
    fechaCompra: z.array(evidenceSourceSchema)
  }),
  observaciones: z.object({
    caja: observationSchema,
    etiqueta: observationSchema
  }),
  revision: z.array(z.object({
    campo: z.string(),
    estado: reviewStateSchema,
    motivo: z.string()
  }))
});

export type ModelProductDetection = z.infer<typeof modelProductDetectionSchema>;
export function modelProductDetectionSchemaFor(productKind: import('./config.ts').ProductKind) {
  return modelProductDetectionSchema.extend({
    producto: modelProductDetectionSchema.shape.producto.extend({ tipoProducto: z.literal(productKind) })
  });
}
export type ReviewState = z.infer<typeof reviewStateSchema>;
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const analyzeRequestSchema = z.object({
  sessionId: z.uuid(),
  productKind: productKindSchema,
  imagenes: z.partialRecord(z.enum(SOURCE_DATA_IMAGE_KINDS), z.object({ pathname: z.string().min(1) }))
}).superRefine((value, context) => {
  const required = value.productKind === 'CALZADO'
    ? ['caja', 'ticket', 'etiqueta']
    : ['etiquetaRopa', 'ticket', 'prendaCompleta'];
  for (const kind of required) if (!value.imagenes[kind as keyof typeof value.imagenes]) {
    context.addIssue({ code: 'custom', path: ['imagenes', kind], message: `Falta la foto obligatoria ${kind}.` });
  }
  for (const kind of Object.keys(value.imagenes)) if (!required.includes(kind)) {
    context.addIssue({ code: 'custom', path: ['imagenes', kind], message: `La foto ${kind} no corresponde a ${value.productKind}.` });
  }
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const normalizedProductDetectionSchema = z.object({
  productKind: productKindSchema,
  imagenes: z.partialRecord(z.enum(SOURCE_DATA_IMAGE_KINDS), imageUsabilitySchema),
  producto: z.object({
    marca: nullableText,
    modelo: nullableText,
    referencia: nullableText,
    colorway: nullableText,
    subtipo: nullableText,
    tipoProducto: z.enum(['CALZADO', 'ROPA', 'ACCESORIO', 'OTRO']).nullable(),
    genero: z.enum(['UNISEX', 'HOMBRE', 'MUJER', 'NINO', 'NINA', 'DESCONOCIDO']).nullable()
  }),
  variante: z.object({
    tallaOriginal: nullableText,
    tallaNormalizada: nullableText,
    sistemaTalla: z.enum(['EU', 'US', 'UK', 'CM', 'BR', 'ALFABETICO', 'EDAD', 'ALTURA', 'DESCONOCIDO']).nullable(),
    equivalenciasTalla: z.record(z.string(), z.string()),
    filasEquivalenciasTalla: z.array(z.object({
      etiqueta: nullableText,
      genero: z.enum(['HOMBRE', 'MUJER', 'DESCONOCIDO']),
      equivalencias: z.record(z.string(), z.string())
    })),
    upc: nullableText,
    gtinNormalizado: nullableText,
    gtinCheckDigitValido: z.boolean().nullable(),
    cantidad: z.number().int().positive()
  }),
  compra: z.object({
    costeCentimos: z.number().int().nonnegative().nullable(),
    proveedor: nullableText,
    fechaCompra: nullableText
  }),
  ticket: z.object({
    lineas: z.array(ticketLineSchema),
    fechaOperacion: nullableText
  }),
  estados: z.record(z.string(), z.object({
    estado: reviewStateSchema,
    evidencias: z.array(evidenceSourceSchema),
    motivo: nullableText
  }))
});

export type NormalizedProductDetection = z.infer<typeof normalizedProductDetectionSchema>;

export interface TemporaryImageAsset<Kind extends ProductImageKind = ProductImageKind> {
  kind: Kind;
  pathname: string;
  usable: boolean;
  motivo: string | null;
}

export interface DetectionAssetGroups {
  productKind: import('./config.ts').ProductKind;
  sourceDataImages: Record<SourceDataImageKind, TemporaryImageAsset<SourceDataImageKind>>;
}

export interface GenerationReferenceUpload {
  pathname: string;
  uploaded: boolean;
}

export interface GenerationReferenceState {
  requested: boolean;
  hasStoredReferences: boolean;
  images: Partial<Record<GenerationReferenceImageKind, GenerationReferenceUpload>>;
  requiredKinds: readonly GenerationReferenceImageKind[];
  ready: boolean;
}

export interface ContentStatus {
  checked: boolean;
  hasGenerationReferences: boolean;
  hasGeneratedImages: boolean;
  generatedImageCount: number;
}

export function groupTemporarySourceDataAssets(
  request: AnalyzeRequest,
  detection: NormalizedProductDetection
): DetectionAssetGroups {
  const asset = <Kind extends SourceDataImageKind>(kind: Kind): TemporaryImageAsset<Kind> => ({
    kind,
    pathname: request.imagenes[kind]!.pathname,
    usable: detection.imagenes[kind]!.usable,
    motivo: detection.imagenes[kind]!.motivo
  });
  return {
    productKind: request.productKind,
    sourceDataImages: Object.fromEntries(Object.keys(request.imagenes).map((kind) => [kind, asset(kind as SourceDataImageKind)])) as DetectionAssetGroups['sourceDataImages']
  };
}
