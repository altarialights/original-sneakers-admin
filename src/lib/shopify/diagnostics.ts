import { shopifyGraphQL } from './client';

export interface ShopifyLocation {
  id: string;
  name: string;
}

export interface ShopifyVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  inventoryQuantity: number | null;
  inventoryItem: { id: string };
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  variants: { nodes: ShopifyVariant[] };
}

export interface ShopifyDiagnostics {
  shop: {
    name: string;
    myshopifyDomain: string;
  };
  locations: { nodes: ShopifyLocation[] };
  products: { nodes: ShopifyProduct[] };
}

const DIAGNOSTICS_QUERY = `#graphql
  query ShopifyDiagnostics {
    shop {
      name
      myshopifyDomain
    }
    locations(first: 250) {
      nodes {
        id
        name
      }
    }
    products(first: 10) {
      nodes {
        id
        title
        handle
        status
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            inventoryQuantity
            inventoryItem {
              id
            }
          }
        }
      }
    }
  }
`;

export function getShopifyDiagnostics(): Promise<ShopifyDiagnostics> {
  return shopifyGraphQL<ShopifyDiagnostics>(DIAGNOSTICS_QUERY);
}
