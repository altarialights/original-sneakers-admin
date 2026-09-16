// @ts-check

import vercel from "@astrojs/vercel";
import { defineConfig, envField } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    output: "server",
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

            OPENAI_API_KEY: envField.string({
                context: "server",
                access: "secret",
                min: 1,
            }),

            OPENAI_VISION_MODEL: envField.string({
                context: "server",
                access: "secret",
                optional: true,
                min: 1,
            }),

            OPENAI_CONTENT_TEXT_MODEL: envField.string({
                context: "server",
                access: "secret",
                optional: true,
                min: 1,
            }),

            OPENAI_CONTENT_IMAGE_MODEL: envField.string({
                context: "server",
                access: "secret",
                optional: true,
                min: 1,
            }),

            BLOB_STORE_ID: envField.string({
                context: "server",
                access: "secret",
                min: 1,
            }),

            VERCEL_OIDC_TOKEN: envField.string({
                context: "server",
                access: "secret",
                min: 1,
            }),
        },
    },

    vite: {
        plugins: [tailwindcss()],
        ssr: {
            noExternal: ["zod", "@libsql/client", "openai", "@vercel/blob"],
        },
    },
});
