export type ShopifyErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'SHOP_NOT_PERMITTED'
  | 'INSUFFICIENT_SCOPES'
  | 'GRAPHQL_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE';

export class ShopifyError extends Error {
  constructor(
    public readonly code: ShopifyErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ShopifyError';
  }
}

export function toSafeShopifyError(error: unknown): ShopifyError {
  if (error instanceof ShopifyError) return error;

  return new ShopifyError(
    'NETWORK_ERROR',
    'No se pudo conectar con Shopify. Revisa la red e inténtalo de nuevo.'
  );
}
