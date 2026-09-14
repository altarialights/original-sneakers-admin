export type ProductState = 'BORRADOR' | 'ACTIVO' | 'ARCHIVADO';
export type ProductType = 'CALZADO' | 'ROPA' | 'ACCESORIO' | 'OTRO';
export type SizeSystem = 'EU' | 'US' | 'UK' | 'CM' | 'ALFABETICO' | 'EDAD' | 'ALTURA' | 'DESCONOCIDO';
export type Gender = 'UNISEX' | 'HOMBRE' | 'MUJER' | 'NINO' | 'NINA' | 'DESCONOCIDO';
export type AgeGroup = 'BEBE' | 'INFANTIL' | 'ADULTO' | 'DESCONOCIDO';

export interface InventoryListFilters {
  search?: string;
  brand?: string;
  size?: string;
  state?: ProductState | '';
  type?: ProductType | '';
  stock?: 'con' | 'sin' | '';
}

export interface InventoryProductListItem {
  id: string;
  name: string;
  brand: string;
  model: string;
  reference: string;
  colorway: string | null;
  type: ProductType;
  state: ProductState;
  stateLabel: string;
  sizes: string[];
  stock: number;
  priceCents: number;
  imageUrl: string | null;
  shopifyStatus: 'No conectado';
  variants: Array<{ id: string; size: string; sizeSystem: SizeSystem; quantity: number; locationId: string | null }>;
}

export interface InventoryVariantDetail {
  id: string;
  originalSize: string;
  size: string;
  sizeSystem: SizeSystem;
  barcode: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  costCents: number | null;
  quantity: number;
  locations: Array<{ id: string; name: string; quantity: number }>;
  gender: Gender;
  ageGroup: AgeGroup;
  state: ProductState;
}

export interface InventoryProductDetail {
  id: string;
  name: string;
  brand: string;
  model: string;
  reference: string;
  colorway: string | null;
  type: ProductType;
  state: ProductState;
  stateLabel: string;
  stock: number;
  images: string[];
  variants: InventoryVariantDetail[];
}

export interface InventoryStats {
  activeProducts: number;
  availableUnits: number;
  outOfStockProducts: number;
}

export interface InventoryFilterOptions {
  brands: string[];
  sizes: string[];
}

export interface ProductFieldsInput {
  brand: string;
  model: string;
  reference: string;
  colorway?: string | null;
  type: ProductType;
}

export interface VariantFieldsInput {
  size: string;
  sizeSystem: SizeSystem;
  quantity: number;
  pvpCents: number;
  offerCents?: number | null;
  costCents: number;
  barcode?: string | null;
  location: string;
  gender: Gender;
  ageGroup: AgeGroup;
}

export interface CreateProductInput extends ProductFieldsInput {
  variants: VariantFieldsInput[];
}

export type StockReason = 'VENTA' | 'COMPRA' | 'AJUSTE' | 'DEVOLUCION';
