// @ts-check
import node from '@astrojs/node';
import { defineConfig, envField } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  adapter: node({ mode: 'standalone' }),
  env: {
    schema: {
      SHOPIFY_SHOP: envField.string({ context: 'server', access: 'secret', min: 1 }),
      SHOPIFY_CLIENT_ID: envField.string({ context: 'server', access: 'secret', min: 1 }),
      SHOPIFY_CLIENT_SECRET: envField.string({ context: 'server', access: 'secret', min: 1 }),
      TURSO_DATABASE_URL: envField.string({ context: 'server', access: 'secret', min: 1 }),
      TURSO_AUTH_TOKEN: envField.string({ context: 'server', access: 'secret', min: 1 })
    }
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
