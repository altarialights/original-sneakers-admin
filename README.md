# Astro Starter Kit: Minimal

## Alta de producto mediante fotografías (fase preview)

La ruta `/anadir/fotos` permite subir tres fotografías obligatorias a Vercel Blob privado: caja, ticket y etiqueta. OpenAI las analiza conjuntamente y la aplicación muestra la ficha editable de inmediato. Esta fase no inserta productos, variantes, stock ni movimientos; Turso se usa solo para comprobar duplicados y contenido mediante `SELECT`.

Internamente se separan `sourceDataImages` (`caja`, `ticket`, `etiqueta`) y `generationReferenceImages` (`referenciaLateral`, `referenciaTrasera`). Las referencias solo aparecen y se suben cuando el usuario elige **Crear imágenes** o **Generar nuevas**. No se llama todavía a Image API ni se promocionan assets a recursos permanentes.

Cada tarjeta usa una guía estática desde `public/onboarding/product-photo-guide/`. Estas imágenes de ejemplo nunca pasan por Vercel Blob ni forman parte del contenido del producto.

Tras la detección se consulta `biblioteca_contenido` y `recursos_contenido` por `producto_id` para contar imágenes generadas y localizar futuras referencias maestras. Si el producto aún no existe, su identidad visual es un SHA-256 determinista de marca, referencia y colorway normalizados; la talla se excluye para reutilizar contenido entre variantes.

Cuando se implemente la promoción a contenido permanente, los binarios mantendrán los prefijos `productos/{productoId}/originales/` y `productos/{productoId}/generadas/`; en esta fase no se escribe ninguno.

Variables server-side utilizadas:

```dotenv
OPENAI_API_KEY=...
# Opcional; por defecto gpt-5.4-mini. Para comparar, usa gpt-5-mini o gpt-5.4-nano.
OPENAI_VISION_MODEL=...
BLOB_STORE_ID=...
BLOB_WEBHOOK_PUBLIC_KEY=...
VERCEL_OIDC_TOKEN=...
TURSO_DATABASE_URL=...
TURSO_AUTH_TOKEN=...
```

No se utiliza ni se requiere `BLOB_READ_WRITE_TOKEN`. Vercel proporciona OIDC en Preview/Production. En desarrollo, enlaza el proyecto y descarga un token vigente:

```sh
pnpm dlx vercel link
pnpm dlx vercel env pull .env.local
```

Si el token local caduca, repite `pnpm dlx vercel env pull .env.local`. Nunca se hace fallback a Blob público.

Prueba manual:

1. Ejecuta `pnpm dev`.
2. Abre `http://localhost:4321/anadir/fotos`.
3. Sube caja, ticket y etiqueta.
4. Pulsa **Analizar producto**.
5. Comprueba y edita la ficha de preview.
6. Decide si reutilizas contenido, preparas imágenes nuevas o continúas sin ellas.
7. Pulsa **Cancelar y eliminar fotos** para limpiar los blobs realmente presentes en la sesión temporal.

La cancelación lista únicamente el prefix exacto de la sesión y borra los blobs seguros realmente existentes. Una política automática de retención para sesiones abandonadas queda fuera de esta fase.

```sh
pnpm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `pnpm install`             | Installs dependencies                            |
| `pnpm dev`             | Starts local dev server at `localhost:4321`      |
| `pnpm build`           | Build your production site to `./dist/`          |
| `pnpm preview`         | Preview your build locally, before deploying     |
| `pnpm astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `pnpm astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
