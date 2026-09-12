export type StockStatus = 'Disponible' | 'Sin stock' | 'Revisar' | 'De baja';
export type ShopifyStatus = 'Publicado' | 'No publicado' | 'Desactualizado';
export type ProductTone = 'stone' | 'blue' | 'amber' | 'rose' | 'green' | 'violet';

export interface MockVariant {
  id: string;
  size: string;
  sizeSystem: 'EU' | 'US' | 'UK';
  quantity: number;
  price: number;
  cost: number;
  barcode?: string;
}

export interface MockProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  reference: string;
  colorway: string;
  upc: string;
  type: 'Calzado' | 'Ropa' | 'Accesorio';
  status: StockStatus;
  sizes: string[];
  stock: number;
  price: number;
  cost: number;
  tone: ProductTone;
  imageCount: number;
  shopifyStatus: ShopifyStatus;
  variants: MockVariant[];
}
