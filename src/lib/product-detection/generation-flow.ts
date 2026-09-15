import { generationReferenceImageKinds, type GenerationReferenceImageKind, type ProductKind } from './config.ts';
import type { ContentStatus, GenerationReferenceState } from './schemas.ts';

export type ContentChoice = 'UNDECIDED' | 'USE_EXISTING' | 'GENERATE_NEW' | 'SKIP';

export function generationReferenceState(
  contentStatus: ContentStatus,
  choice: ContentChoice,
  images: GenerationReferenceState['images'] = {},
  productKind: ProductKind = 'CALZADO'
): GenerationReferenceState {
  const requested = choice === 'GENERATE_NEW';
  const requiredKinds: readonly GenerationReferenceImageKind[] = requested && !contentStatus.hasGenerationReferences
    ? generationReferenceImageKinds(productKind)
    : [];
  return {
    requested,
    hasStoredReferences: contentStatus.hasGenerationReferences,
    images,
    requiredKinds,
    ready: requested && (contentStatus.hasGenerationReferences || requiredKinds.every((kind) => images[kind]?.uploaded))
  };
}

export function canContinueProductFlow(choice: ContentChoice): boolean {
  return choice === 'SKIP' || choice === 'USE_EXISTING';
}
