"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import "./connections.css";

type Connection = {
  id: string;
  product: "gmail" | "sheets" | "drive" | "calendar" | "docs" | "forms" | "youtube" | "contacts";
  account_email: string;
  scopes: string[];
  status: "connected" | "needs_reauth" | "revoked";
  expires_at: string | null;
};

const statusMessages: Record<string, string> = {
  connected: "Google account authorized. Credentials are stored encrypted on the server.",
  cancelled: "Authorization was cancelled. No connection was added.",
  invalid_state: "The authorization response could not be verified. Start again for your security.",
  sign_in_required: "Your session expired. Sign in and try again.",
  token_exchange_failed: "Google could not complete authorization. Please try again.",
  profile_failed: "A verified Google account profile could not be confirmed.",
  server_not_configured: "Connection storage is not configured for this environment.",
  save_failed: "Authorization succeeded, but Aivanta could not save the connection.",
  connection_failed: "The connection could not be completed. No credentials were shown.",
  not_configured: "Google OAuth is not configured for this environment yet.",
};


type WorkspaceProvider = "openai" | "gemini" | "resend" | "slack" | "http" | "notion" | "hubspot" | "twilio" | "shopify" | "stripe" | "linear" | "claude" | "mistral" | "groq" | "perplexity" | "discord" | "telegra¶»§q«^