import "server-only";

export const GOOGLE_PRODUCTS = {
  gmail: {
    label: "Gmail",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  },
  sheets: {
    label: "Google Sheets",
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  },
} as const;

export type GoogleProduct = keyof typeof GOOGLE_PRODUCTS;

const GOOGLE_IDENTITY_SCOPES = new Set(["openid", "email", "profile"]);

/**
 * If Google returns a granted-scope list, require the product's exact read-only
 * scope and allow only the minimal identity scopes requested by Aivanta.
 * Google may omit the scope field when the grant matches the requested scopes;
 * in that case, the authorization request remains the boundary because
 * include_granted_scopes=false.
 */
export function hasOnlyApprovedGoogleScopes(product: GoogleProduct, scopeValue: unknown): boolean {
  if (scopeValue == null || scopeValue === "") return true;
  if (typeof scopeValue !== "string") return false;

  const granted = scopeValue.split(/\s+/).filter(Boolean);
  const requiredProductScope = GOOGLE_PRODUCTS[product].scopes[0];
  const allowed = new Set([...GOOGLE_IDENTITY_SCOPES, requiredProductScope]);
  return granted.includes(requiredProductScope) && granted.every((scope) => allowed.has(scope));
}

export function isGoogleProduct(value: string | null | undefined): value is GoogleProduct {
  return value != null && Object.hasOwn(GOOGLE_PRODUCTS, value);
}

export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.");
  }
  const callback = new URL(redirectUri);
  if (callback.protocol !== "https:" && !(callback.protocol === "http:" && callback.hostname === "localhost")) {
    throw new Error("Google OAuth redirect URI must use HTTPS outside localhost.");
  }
  if (callback.pathname !== "/api/integrations/google/callback") {
    throw new Error("Google OAuth redirect URI must use the Aivanta Google callback path.");
  }
  return { clientId, clientSecret, redirectUri };
}
