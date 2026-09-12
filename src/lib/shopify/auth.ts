import {
    SHOPIFY_CLIENT_ID,
    SHOPIFY_CLIENT_SECRET,
    SHOPIFY_SHOP,
} from "astro:env/server";
import { ShopifyError } from "./errors";

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface TokenResponse {
    access_token: string;
    expires_in: number;
    scope?: string;
}

interface CachedToken {
    accessToken: string;
    expiresAt: number;
}

let cachedToken: CachedToken | undefined;
let tokenRequest: Promise<CachedToken> | undefined;

function getShopDomain(): string {
    const shop = SHOPIFY_SHOP.trim().toLowerCase();

    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(shop)) {
        throw new ShopifyError(
            "CONFIGURATION_ERROR",
            "SHOPIFY_SHOP debe ser únicamente el subdominio de la tienda, sin .myshopify.com.",
        );
    }

    return `${shop}.myshopify.com`;
}

function isTokenResponse(value: unknown): value is TokenResponse {
    if (typeof value !== "object" || value === null) return false;

    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.access_token === "string" &&
        candidate.access_token.length > 0 &&
        typeof candidate.expires_in === "number" &&
        candidate.expires_in > 0
    );
}

async function requestToken(): Promise<CachedToken> {
    const response = await fetch(
        `https://${getShopDomain()}/admin/oauth/access_token`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: SHOPIFY_CLIENT_ID,
                client_secret: SHOPIFY_CLIENT_SECRET,
            }),
        },
    );

    const rawBody = await response.text();
    let body: unknown;

    try {
        body = JSON.parse(rawBody);
    } catch {
        body = undefined;
    }

    if (!response.ok) {
        const normalizedBody = rawBody.toLowerCase();

        if (normalizedBody.includes("shop_not_permitted")) {
            throw new ShopifyError(
                "SHOP_NOT_PERMITTED",
                "Shopify no permite client credentials para esta tienda. Comprueba que la app y la tienda pertenezcan a la misma organización.",
                response.status,
            );
        }

        if (response.status === 400 || response.status === 401) {
            throw new ShopifyError(
                "INVALID_CREDENTIALS",
                "Shopify rechazó las credenciales. Revisa SHOPIFY_CLIENT_ID y SHOPIFY_CLIENT_SECRET.",
                response.status,
            );
        }

        throw new ShopifyError(
            "INVALID_RESPONSE",
            `Shopify rechazó la autenticación (HTTP ${response.status}).`,
            response.status,
        );
    }

    if (!isTokenResponse(body)) {
        throw new ShopifyError(
            "INVALID_RESPONSE",
            "Shopify devolvió una respuesta de autenticación no válida.",
        );
    }

    return {
        accessToken: body.access_token,
        expiresAt: Date.now() + body.expires_in * 1000,
    };
}

export function invalidateAccessToken(): void {
    cachedToken = undefined;
}

export async function getAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt - EXPIRY_BUFFER_MS > Date.now()) {
        return cachedToken.accessToken;
    }

    tokenRequest ??= requestToken();

    try {
        cachedToken = await tokenRequest;
        return cachedToken.accessToken;
    } finally {
        tokenRequest = undefined;
    }
}

export function getShopifyDomain(): string {
    return getShopDomain();
}
