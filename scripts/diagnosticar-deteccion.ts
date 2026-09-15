import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readPrivateSessionImages } from '../src/lib/product-detection/blob.ts';
import { reconcileProductDetection } from '../src/lib/product-detection/normalize.ts';
import { extractProductWithOpenAI } from '../src/lib/product-detection/openai.ts';
import { analyzeRequestSchema } from '../src/lib/product-detection/schemas.ts';

const requestFlag = process.argv.indexOf('--request');
if (requestFlag < 0 || !process.argv[requestFlag + 1]) {
  throw new Error('Uso: pnpm diagnose:photos -- --request ruta-request.json [--openai]');
}

const request = analyzeRequestSchema.parse(JSON.parse(
  await readFile(resolve(process.argv[requestFlag + 1]), 'utf8')
));
const pathnames = Object.fromEntries(Object.entries(request.imagenes).map(([kind, image]) => [kind, image.pathname]));
const totalStartedAt = performance.now();
const blobStartedAt = performance.now();
const images = await readPrivateSessionImages(request.sessionId, request.productKind, pathnames);
console.info(`[product-detection] diagnostic:blobs-completed durationMs=${Math.round(performance.now() - blobStartedAt)}`);

if (process.argv.includes('--openai')) {
  const openAIStartedAt = performance.now();
  const extracted = await extractProductWithOpenAI(images, request.productKind);
  console.info(`[product-detection] diagnostic:openai-completed durationMs=${Math.round(performance.now() - openAIStartedAt)}`);
  const normalizeStartedAt = performance.now();
  reconcileProductDetection(extracted, request.productKind);
  console.info(`[product-detection] diagnostic:normalize-completed durationMs=${Math.round(performance.now() - normalizeStartedAt)}`);
} else {
  console.info('[product-detection] diagnostic:openai-skipped (añade --openai para una única llamada explícita)');
}
console.info(`[product-detection] diagnostic:completed durationMs=${Math.round(performance.now() - totalStartedAt)}`);
