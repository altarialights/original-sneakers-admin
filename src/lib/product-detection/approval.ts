import type { Client } from '@libsql/client';
import {
  approvePhotoInventory,
  parsePhotoApprovalPayload,
  type PhotoApprovalInput,
  type PhotoApprovalResult
} from '../inventory/photo-approval.ts';
import { deleteTemporarySourceImages } from './blob.ts';

export async function approveProductFromPhotos(
  value: unknown,
  dependencies: {
    database?: Client;
    inventoryApprover?: (input: PhotoApprovalInput, database?: Client) => Promise<PhotoApprovalResult>;
    sourceImageCleanup?: (sessionId: string, productKind: PhotoApprovalInput['tipoProducto']) => Promise<number>;
  } = {}
): Promise<PhotoApprovalResult & { cleanupSucceeded: boolean; cleanedImages: number }> {
  const input = parsePhotoApprovalPayload(value);
  const inventoryApprover = dependencies.inventoryApprover ?? approvePhotoInventory;
  const result = await inventoryApprover(input, dependencies.database);
  let cleanupSucceeded = true;
  let cleanedImages = 0;
  try {
    cleanedImages = await (dependencies.sourceImageCleanup ?? deleteTemporarySourceImages)(
      input.sessionId,
      input.tipoProducto
    );
  } catch {
    cleanupSucceeded = false;
    console.warn(`[product-detection] approval cleanup failed sessionId=${input.sessionId}`);
  }
  return { ...result, cleanupSucceeded, cleanedImages };
}
