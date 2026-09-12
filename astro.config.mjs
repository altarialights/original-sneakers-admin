// @ts-check

import vercel from "@astrojs/vercel";
import { defineConfig, envField } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    adapter: vercel(),

    env: {
        schema: {
            SHOPIFY_SHOP: envField.string({
                context: "server",
                access: "secret",
                min: 1,
            }),

            SHOPIFY_CLIENT_ID: envField.string({
                context: "server",
                access: "secret",
                min: 1,
            }),

            SHOPIFY_CLIENT_SECRET: envField.string({
                context: "server",
                access: "secret",
                min: 1,
            }),

            TURSO_DATABASE_URL: envField.string({
                context: "server",
                access: "secret",
                min: 1,
            }),

            TURSO_AUTH_TOKEN: envField.string({
                context: "server",
                access: "secret",
                min: 1,
            }),
        },
    },

    vite: {
        plugins: [tailwindcss()],
    },
});
