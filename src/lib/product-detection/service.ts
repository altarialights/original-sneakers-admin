import type OpenAI from 'openai';
import type { Client } from '@libsql/client';
import { readPrivateSessionImages } from './blob.ts';
import { checkExistingContent, emptyContentStatus } from './content-status.ts';
import { checkDetectionDuplicates, type DuplicateCheck } from './duplicates.ts';
import { extractProductWithOpenAI } from './openai.ts';
import { reconcileProductDetection } from './normalize.ts';
import {
  analyzeRequestSchema,
  groupTemporarySourceDataAssets,
  type AnalyzeRequest,
  type ModelProductDetection
} from './schemas.ts';

export async function analyzeProductPhotos(
  request: AnalyzeRequest,
  dependencies: {
    imageReader?: typeof readPrivateSessionImages;
    extractor?: (images: Awaited<ReturnType<typeof readPrivateSessionImages>>) => Promise<ModelProductDetection>;
    duplicateDatabase?: Pick<Client, 'execute'>;
    openAIClient?: OpenAI;
  } = {}
) {
  console.info('[product-detection] analyze:start');
  const input = analyzeRequestSchema.parse(request);
  const pathnames = Object.fromEntries(Object.entries(input.imagenes).map(([kind, image]) => [kind, image.pathname]));
  const images = await (dependencies.imageReader ?? readPrivateSessionImages)(input.sessionId, input.productKind, pathnames);
  const extracted = dependencies.extractor
    ? await dependencies.extractor(images)
    : await extractProductWithOpenAI(images, input.productKind, { client: dependencies.openAIClient });
  const detection = reconcileProductDetection(extracted, input.productKind);
  console.info('[product-detection] normalize:completed');
  let duplicates: DuplicateCheck;
  try {
    duplicates = await checkDetectionDuplicates(detection, dependencies.duplicateDatabase);
  } catch {
    console.error('[product-detection] duplicate read check failed');
    duplicates = {
      checked: false,
      productExists: false,
      productId: null,
      variantExists: false,
      variantId: null
    };
  }
  let contentStatus;
  try {
    contentStatus = await checkExistingContent(detection, duplicates, dependencies.duplicateDatabase);
    console.info('[product-detection] content-status:completed');
  } catch {
    console.error('[product-detection] content read check failed');
    contentStatus = emptyContentStatus(false);
  }
  console.info('[product-detection] analyze:completed');
  return { detection, duplicates, contentStatus, assets: groupTemporarySourceDataAssets(input, detection) };
}
