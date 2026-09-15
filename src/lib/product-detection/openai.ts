import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  estimateOpenAIRequestCostUsd,
  OPENAI_IMAGE_DETAIL_BY_KIND,
  OPENAI_TIMEOUT_MS,
  PRODUCT_IMAGE_LABELS,
  reasoningEffortForVisionModel,
  sourceDataImageKinds,
  type ProductKind,
  type SourceDataImageKind
} from './config.ts';
import { ProductDetectionError } from './errors.ts';
import { getOpenAIConfig } from './env.ts';
import { modelProductDetectionSchemaFor, type ModelProductDetection } from './schemas.ts';

const FOOTWEAR_EXTRACTION_INSTRUCTIONS = `Eres un extractor de datos de inventario para una tienda de zapatillas.
Recibirás exactamente tres imágenes etiquetadas: CAJA, TICKET y ETIQUETA DE LA ZAPATILLA.

Reglas obligatorias:
- Extrae únicamente datos observables y legibles. No inventes ni completes por conocimiento externo.
- Si un dato no es legible o no aparece, devuelve null.
- Las fuentes primarias de referencia, talla y UPC son CAJA y ETIQUETA. Si son legibles, nunca las sustituyas por una deducción visual.
- TICKET es la única fuente de proveedor, fecha, códigos e importes.
- Marca usable=false cuando una foto no permita cumplir su función; explica el motivo de forma breve y específica.
- Los UPC, EAN, GTIN, referencias y códigos son siempre strings. Conserva cualquier cero inicial.
- No asumas UPC, coste, talla, colorway comercial, proveedor ni fecha.
- El dinero se expresa como céntimos enteros no negativos.
- La fecha usa YYYY-MM-DD solo cuando se identifica sin ambigüedad.
- Busca etiquetas semánticas como "Fecha Origen", "Fecha de compra original", "Fecha operación", "Fecha devolución" o equivalentes. Si el ticket distingue una fecha de origen/compra original de otra fecha posterior de operación, devolución o reemisión, devuelve la primera en fechaOrigenCompra y la segunda en fechaOperacion. Usa fechaCompra para la fecha general solo cuando no haya una fecha de origen diferenciada; no elijas una fecha por ser la primera, la última o la más reciente.
- Devuelve todas las líneas relevantes del ticket, incluyendo sus códigos y precio final cuando sean legibles.
- No selecciones ni calcules el coste de compra por similitud de descripción. Nuestro servidor hará el match exacto de código.
- Registra por separado las observaciones de referencia, talla y UPC visibles en caja y etiqueta, incluso si discrepan.
- En observaciones.caja.talla y observaciones.etiqueta.talla conserva todas las equivalencias legibles (EU, US, UK, CM, BR, etc.). Para calzado, usa EU como sistema principal cuando sea legible; si no, prioriza US, UK, CM, BR y después cualquier otro sistema visible.
- Si una etiqueta contiene varias filas o tablas MENS/WMNS, devuelve cada conjunto completo y separado en observaciones.<fuente>.filasTalla. MENS corresponde a genero HOMBRE y WMNS a MUJER. Nunca mezcles el US o CM de una fila con el EU de otra. Si no hay filas separadas, devuelve filasTalla=[].
- No sustituyas caracteres en referencias por semejanza OCR (por ejemplo I/1, O/0 o S/5); conserva todos los prefijos alfabéticos observados.
- En observaciones.caja.barcodeDigits transcribe los dígitos impresos junto o debajo del código de barras, aunque estén en vertical o separados visualmente. No inventes dígitos; usa null si no son legibles.
- No uses porcentajes de confianza.
- cantidad es 1 salvo que exista evidencia inequívoca de otra cantidad.
- No incluyas datos personales incidentales del ticket fuera de proveedor, fecha y líneas de compra.`;

const CLOTHING_EXTRACTION_INSTRUCTIONS = `Eres un extractor de datos de inventario para una tienda de ropa.
Recibirás exactamente tres imágenes: ETIQUETA DE LA PRENDA, TICKET y FOTO COMPLETA DE LA PRENDA.

Reglas obligatorias:
- Extrae únicamente datos observables y legibles; no inventes datos.
- La etiqueta de la prenda prevalece para referencia, talla y UPC/EAN/GTIN. Registra sus valores en observaciones.caja y su usabilidad en imagenes.caja.
- La foto completa ayuda con subtipo, nombre, color principal y estilo. Registra datos complementarios en observaciones.etiqueta y su usabilidad en imagenes.etiqueta.
- TICKET es la única fuente de proveedor, fecha, códigos e importes.
- producto.tipoProducto debe ser ROPA; producto.subtipo solo se completa si es observable. Usa colorway como color principal.
- Usa ALFABETICO para XS/S/M/L/XL y el sistema visible para tallas numéricas.
- filasTalla es exclusivo de equivalencias de calzado; para ropa devuelve siempre filasTalla=[].
- Códigos y referencias son strings y conservan ceros iniciales. No normalices los GTIN a 14 dígitos.
- Devuelve todas las líneas relevantes del ticket. Nunca asignes coste por nombre o texto similar.
- Si aparecen una fecha de origen/compra original y otra fecha posterior de operación o devolución, sepáralas en fechaOrigenCompra y fechaOperacion; no uses la fecha posterior como fechaCompra.
- Dinero en céntimos enteros; fecha YYYY-MM-DD solo si es inequívoca; cantidad 1 salvo evidencia clara.
- No incluyas datos personales incidentales.`;

export interface DetectionImageInput {
  kind: SourceDataImageKind;
  dataUrl: string;
}

interface UsageLike {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}

interface OpenAIErrorLike {
  name?: string;
  status?: number;
  requestID?: string | null;
  request_id?: string | null;
}

function errorMetadata(error: unknown) {
  const candidate = error && typeof error === 'object' ? error as OpenAIErrorLike : {};
  return {
    type: candidate.name || (error instanceof Error ? error.constructor.name : 'UnknownError'),
    status: candidate.status ?? null,
    requestId: candidate.requestID ?? candidate.request_id ?? null
  };
}

export function publicOpenAIError(error: unknown): ProductDetectionError {
  const metadata = errorMetadata(error);
  const detail = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : '';
  if (error instanceof OpenAI.AuthenticationError || metadata.status === 401) {
    return new ProductDetectionError('No hemos podido autenticar el servicio de análisis. Revisa la configuración de OpenAI.', 'OPENAI_AUTHENTICATION_ERROR', 503);
  }
  if (error instanceof OpenAI.RateLimitError || metadata.status === 429) {
    return new ProductDetectionError('El servicio de análisis ha alcanzado temporalmente su límite. Inténtalo de nuevo en unos minutos.', 'OPENAI_RATE_LIMIT', 429);
  }
  if (error instanceof OpenAI.BadRequestError || error instanceof OpenAI.UnprocessableEntityError || metadata.status === 400 || metadata.status === 422) {
    return new ProductDetectionError('OpenAI ha rechazado las imágenes o el formato de análisis.', 'OPENAI_REQUEST_INVALID', 502);
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError || metadata.type === 'APIConnectionTimeoutError' || detail.includes('timeout') || detail.includes('abort')) {
    return new ProductDetectionError('El análisis está tardando demasiado. Inténtalo otra vez.', 'OPENAI_TIMEOUT', 504);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new ProductDetectionError('No hemos podido conectar con el servicio de análisis. Inténtalo otra vez.', 'OPENAI_CONNECTION_ERROR', 503);
  }
  if (error instanceof OpenAI.InternalServerError || (metadata.status !== null && metadata.status >= 500)) {
    return new ProductDetectionError('OpenAI ha tenido un error temporal. Inténtalo otra vez.', 'OPENAI_SERVER_ERROR', 502);
  }
  return new ProductDetectionError('No hemos podido analizar las imágenes en este momento. Inténtalo otra vez.', 'OPENAI_ERROR', 502);
}

export async function extractProductWithOpenAI(
  images: DetectionImageInput[],
  productKind: ProductKind = 'CALZADO',
  options: {
    client?: OpenAI;
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
  } = {}
): Promise<ModelProductDetection> {
  const receivedKinds = new Set(images.map((image) => image.kind));
  const requiredKinds = sourceDataImageKinds(productKind);
  if (images.length !== requiredKinds.length || requiredKinds.some((kind) => !receivedKinds.has(kind))) {
    throw new ProductDetectionError('Necesitamos las tres fotos para analizar el producto.', 'FALTAN_IMAGENES');
  }
  const configured = options.apiKey && options.model
    ? { apiKey: options.apiKey, model: options.model }
    : await getOpenAIConfig();
  const timeoutMs = options.timeoutMs ?? OPENAI_TIMEOUT_MS;
  const client = options.client ?? new OpenAI({ apiKey: configured.apiKey, maxRetries: 0, timeout: timeoutMs });
  const outputSchema = modelProductDetectionSchemaFor(productKind);
  const content: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string; detail: 'auto' | 'high' }
  > = [{ type: 'input_text', text: 'Analiza las tres imágenes conjuntamente y devuelve el resultado estructurado.' }];
  for (const image of images) {
    content.push({ type: 'input_text', text: `IMAGEN ${PRODUCT_IMAGE_LABELS[image.kind]}` });
    content.push({ type: 'input_image', image_url: image.dataUrl, detail: OPENAI_IMAGE_DETAIL_BY_KIND[image.kind] });
  }

  const startedAt = performance.now();
  console.info('[product-detection] openai:start');
  try {
    const reasoningEffort = reasoningEffortForVisionModel(configured.model);
    const response = await client.responses.parse({
      model: configured.model,
      store: false,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      instructions: productKind === 'CALZADO' ? FOOTWEAR_EXTRACTION_INSTRUCTIONS : CLOTHING_EXTRACTION_INSTRUCTIONS,
      input: [{ role: 'user', content }],
      text: {
        format: zodTextFormat(outputSchema, 'product_photo_detection', {
          description: 'Datos observables y usabilidad de caja, ticket y etiqueta para revisión humana.'
        }),
        verbosity: 'low'
      }
    }, { timeout: timeoutMs });

    const durationMs = Math.round(performance.now() - startedAt);
    const requestId = (response as unknown as { _request_id?: string | null })._request_id ?? null;
    const validated = outputSchema.safeParse(response.output_parsed);
    if (!validated.success) {
      console.error(`[product-detection] openai:error type=StructuredOutputInvalid status=n/a requestId=${requestId ?? 'n/a'} durationMs=${durationMs}`);
      throw new ProductDetectionError(
        'No hemos podido analizar correctamente las imágenes. Inténtalo otra vez.',
        'OPENAI_RESPUESTA_INVALIDA',
        502
      );
    }
    const usage = response.usage as UsageLike | undefined;
    const inputTokens = usage?.input_tokens;
    const outputTokens = usage?.output_tokens;
    const cachedInputTokens = usage?.input_tokens_details?.cached_tokens;
    const estimatedCostUsd = inputTokens !== undefined && outputTokens !== undefined
      ? estimateOpenAIRequestCostUsd(configured.model, { inputTokens, outputTokens, cachedInputTokens })
      : null;
    console.info(
      `[product-detection] openai:completed durationMs=${durationMs} requestId=${requestId ?? 'n/a'} model=${configured.model} reasoningEffort=${reasoningEffort ?? 'default'} inputTokens=${inputTokens ?? 'n/a'} cachedInputTokens=${cachedInputTokens ?? 'n/a'} outputTokens=${outputTokens ?? 'n/a'} totalTokens=${usage?.total_tokens ?? 'n/a'}${process.env.NODE_ENV === 'development' ? ` estimatedCostUsd=${estimatedCostUsd ?? 'n/a'}` : ''}`
    );
    return validated.data;
  } catch (error) {
    if (error instanceof ProductDetectionError) throw error;
    const metadata = errorMetadata(error);
    console.error(`[product-detection] openai:error type=${metadata.type} status=${metadata.status ?? 'n/a'} requestId=${metadata.requestId ?? 'n/a'} durationMs=${Math.round(performance.now() - startedAt)}`);
    throw publicOpenAIError(error);
  }
}

export { FOOTWEAR_EXTRACTION_INSTRUCTIONS as EXTRACTION_INSTRUCTIONS, CLOTHING_EXTRACTION_INSTRUCTIONS };
