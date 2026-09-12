import type { MockProduct } from './types';

// Datos exclusivamente visuales. No proceden de Turso, Shopify ni ninguna API.
export const mockProducts: MockProduct[] = [
  {
    id: 'nike-air-force-1-retro-prm', name: 'Nike Air Force 1 Retro PRM', brand: 'Nike', model: 'Air Force 1 Retro PRM',
    reference: 'IR0871-400', colorway: 'Hydrogen Blue / Football Grey', upc: '198730356907', type: 'Calzado', status: 'Disponible',
    sizes: ['40', '41', '42.5'], stock: 3, price: 149.9, cost: 79.99, tone: 'blue', imageCount: 4,
    shopifyStatus: 'Publicado',
    variants: [
      { id: 'af1-40', size: '40', sizeSystem: 'EU', quantity: 1, price: 149.9, cost: 79.99, barcode: '198730356884' },
      { id: 'af1-41', size: '41', sizeSystem: 'EU', quantity: 0, price: 149.9, cost: 79.99, barcode: '198730356891' },
      { id: 'af1-425', size: '42.5', sizeSystem: 'EU', quantity: 2, price: 149.9, cost: 79.99, barcode: '198730356907' }
    ]
  },
  {
    id: 'nike-dunk-low-panda', name: 'Nike Dunk Low Panda', brand: 'Nike', model: 'Dunk Low Panda',
    reference: 'DD1391-100', colorway: 'Black / White', upc: '194953241014', type: 'Calzado', status: 'Disponible',
    sizes: ['40', '41', '42', '43', '44'], stock: 7, price: 119.9, cost: 72, tone: 'stone', imageCount: 6,
    shopifyStatus: 'Desactualizado',
    variants: [
      { id: 'dunk-40', size: '40', sizeSystem: 'EU', quantity: 1, price: 119.9, cost: 72 },
      { id: 'dunk-41', size: '41', sizeSystem: 'EU', quantity: 2, price: 119.9, cost: 72 },
      { id: 'dunk-42', size: '42', sizeSystem: 'EU', quantity: 0, price: 119.9, cost: 72 },
      { id: 'dunk-43', size: '43', sizeSystem: 'EU', quantity: 3, price: 119.9, cost: 72 },
      { id: 'dunk-44', size: '44', sizeSystem: 'EU', quantity: 1, price: 119.9, cost: 72 }
    ]
  },
  {
    id: 'nike-vomero-5', name: 'Nike Vomero 5', brand: 'Nike', model: 'Vomero 5',
    reference: 'FB8825-001', colorway: 'Photon Dust', upc: '196969172649', type: 'Calzado', status: 'Revisar',
    sizes: ['40', '41', '42.5', '44'], stock: 5, price: 159.9, cost: 96, tone: 'green', imageCount: 3,
    shopifyStatus: 'No publicado',
    variants: [
      { id: 'vomero-40', size: '40', sizeSystem: 'EU', quantity: 1, price: 159.9, cost: 96 },
      { id: 'vomero-41', size: '41', sizeSystem: 'EU', quantity: 1, price: 159.9, cost: 96 },
      { id: 'vomero-425', size: '42.5', sizeSystem: 'EU', quantity: 2, price: 159.9, cost: 96 },
      { id: 'vomero-44', size: '44', sizeSystem: 'EU', quantity: 1, price: 159.9, cost: 96 }
    ]
  },
  {
    id: 'jordan-1-mid', name: 'Jordan 1 Mid', brand: 'Jordan', model: 'Air Jordan 1 Mid',
    reference: 'DQ8426-106', colorway: 'White / Gym Red', upc: '196149835704', type: 'Calzado', status: 'Sin stock',
    sizes: ['41', '42', '43', '44'], stock: 0, price: 139.9, cost: 84, tone: 'rose', imageCount: 5,
    shopifyStatus: 'Publicado',
    variants: [
      { id: 'jordan-41', size: '41', sizeSystem: 'EU', quantity: 0, price: 139.9, cost: 84 },
      { id: 'jordan-42', size: '42', sizeSystem: 'EU', quantity: 0, price: 139.9, cost: 84 }
    ]
  },
  {
    id: 'adidas-campus-00s', name: 'Adidas Campus 00s', brand: 'Adidas', model: 'Campus 00s',
    reference: 'HQ8708', colorway: 'Core Black / White', upc: '4066749842330', type: 'Calzado', status: 'Disponible',
    sizes: ['40', '40 2/3', '42', '42 2/3', '44'], stock: 9, price: 109.9, cost: 64, tone: 'violet', imageCount: 7,
    shopifyStatus: 'Publicado',
    variants: [
      { id: 'campus-40', size: '40', sizeSystem: 'EU', quantity: 2, price: 109.9, cost: 64 },
      { id: 'campus-406', size: '40 2/3', sizeSystem: 'EU', quantity: 2, price: 109.9, cost: 64 },
      { id: 'campus-42', size: '42', sizeSystem: 'EU', quantity: 1, price: 109.9, cost: 64 },
      { id: 'campus-426', size: '42 2/3', sizeSystem: 'EU', quantity: 3, price: 109.9, cost: 64 },
      { id: 'campus-44', size: '44', sizeSystem: 'EU', quantity: 1, price: 109.9, cost: 64 }
    ]
  }
];

export const mockStockStats = [
  { label: 'Productos', value: '5' },
  { label: 'Pares disponibles', value: '24' },
  { label: 'Sin stock', value: '1', tone: 'danger' as const }
];

export const formatMoney = (value: number): string =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
