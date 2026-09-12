import { getAccessToken, getShopifyDomain, invalidateAccessToken } from './auth';
import { ShopifyError } from './errors';

export const SHOPIFY_API_VERSION = '2026-07';

interface GraphQLErrorResponse {
  message?: unknown;
  extensions?: { code?: unknown };
}

interface GraphQLResponse<TData> {
  data?: TData;
  errors?: GraphQLErrorResponse[];
}

function graphqlError(errors: GraphQLErrorResponse[]): ShopifyError {
  const messages = errors
    .map((error) => (typeof error.message === 'string' ? error.message : 'Error GraphQL desconocido'))
    .join('; ');
  const insufficientScopes = errors.some(
    (error) =>
      error.extensions?.code === 'ACCESS_DENIED' ||
      (typeof error.message === 'string' && /access denied|access scope|permission/i.test(error.message))
  );

  return new ShopifyError(
    insufficientScopes ? 'INSUFFICIENT_SCOPES' : 'GRAPHQL_ERROR',
    insufficientScopes
      ? `Scopes insuficientes para la consulta de diagnóstico: ${messages}`
      : `Shopify devolvió errores GraphQL: ${messages}`
  );
}

async function executeGraphQL<TData>(
  query: string,
  variables: Record<string, unknown>,
  retryAuth: boolean
): Promise<TData> {
  const accessToken = await getAccessToken();
  const response = await fetch(
    `https://${getShopifyDomain()}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      },
      body: JSON.stringify({ query, variables })
    }
  );

  if (response.status === 401 && retryAuth) {
    invalidateAccessToken();
    return executeGraphQL<TData>(query, variables, false);
  }

  if (response.status === 401) {
    throw new ShopifyError(
      'INVALID_CREDENTIALS',
      'Shopify rechazó el access token renovado.',
      response.status
    );
  }

  if (response.status === 403) {
    throw new ShopifyError(
      'INSUFFICIENT_SCOPES',
      'La app no tiene scopes suficientes para leer tiendas, locations, productos o inventario.',
      response.status
    );
  }

  if (!response.ok) {
    throw new ShopifyError(
      'INVALID_RESPONSE',
      `La API Admin de Shopify respondió con HTTP ${response.status}.`,
      response.status
    );
  }

  let result: GraphQLResponse<TData>;

  try {
    result = (await response.json()) as GraphQLResponse<TData>;
  } catch {
    throw new ShopifyError('INVALID_RESPONSE', 'Shopify devolvió una respuesta JSON no válida.');
  }

  if (result.errors?.length) throw graphqlError(result.errors);
  if (!result.data) {
    throw new ShopifyError('INVALID_RESPONSE', 'Shopify no devolvió datos para la consulta.');
  }

  return result.data;
}

export function shopifyGraphQL<TData>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<TData> {
  return executeGraphQL<TData>(query, variables, true);
}
