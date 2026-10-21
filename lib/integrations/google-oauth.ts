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

export function isGoogleProduct(value: string | null): value is GoogleProduct {
  return value !== null && Object.hasOwn(GOOGLE_PRODUCTS, value);
}

export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.");
  }
  const callback = new URL(redirectUri);
  if (callback.protocol !== "https:" && callback.hostname !== "localhost") {
    throw new Error("Google OAuth redirect URI must use HTTPS outside localhost.");
  }
  if (callback.pathname !== "/api/integrations/google/callback") {
    throw new Error("Google OAuth redirect URI must use the Aivanta Google callback path.");
  }
  return { clientId, clientSecret, redirectUri };
}
