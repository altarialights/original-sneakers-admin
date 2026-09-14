import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = () => Response.json(
  { build: 'inventory-real-v1' },
  { headers: { 'cache-control': 'no-store, max-age=0' } }
);
