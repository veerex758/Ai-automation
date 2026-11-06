import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

export type ProviderOAuthConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  clientIdParam?: string;
  tokenAuth?: "body" | "basic";
  pkce?: boolean;
  authorizeParams?: Record<string, string>;
  tokenResponsePath?: "data";
  includeTokenScope?: boolean;
  tokenExchangeMode?: "meta-long-lived";
};

const oauthConfig = (provider: string, authorizeUrl: string, tokenUrl: string, scopes: string[], options: Partial<ProviderOAuthConfig> = {}): ProviderOAuthConfig => ({
  authorizeUrl, tokenUrl, scopes,
  clientIdEnv: "AIVANTA_" + provider.toUpperCase() + "_CLIENT_ID",
  clientSecretEnv: "AIVANTA_" + provider.toUpperCase() + "_CLIENT_SECRET",
  pkce: true,
  ...options,
});

export const PROVIDER_OAUTH_CONFIG: Readonly<Record<string, ProviderOAuthConfig>> = {
  microsoft_teams: oauthConfig("microsoft_teams",
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    ["offline_access", "User.Read", "ChannelMessage.Send"], { includeTokenScope: true }),
  salesforce: oauthConfig("salesforce",
    "https://login.salesforce.com/services/oauth2/authorize",
    "https://login.salesforce.com/services/oauth2/token",
    ["api", "refresh_token"], { pkce: false }),
  pipedrive: oauthConfig("pipedrive",
    "https://oauth.pipedrive.com/oauth/authorize",
   ¶»§q«^