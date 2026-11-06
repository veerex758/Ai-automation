import { createHash, createHmac } from "node:crypto";
import { Pool } from "pg";
import { createConnection as createMysqlConnection } from "mysql2/promise";
import { MongoClient } from "mongodb";
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { decryptWorkspaceCredentials, type WorkspaceCredentialProvider } from "@/lib/integrations/workspace-credentials";
import { performSafeHttpRequest } from "@/nodes/safe-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function signedS3Headers(url: URL, accessKeyId: string, secretAccessKey: string, region: string): Record<string, string> {
  const amzDate = new Date().toISOString().replace(/[:-]|\\.\\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update("").digest("hex");
  const canonicalHeaders = "host:" + url.host + "\\n" + "x-amz-content-sha256:" + payloadHash + "\\n" + "x-amz-date:" + amzDate + "\\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["GET", url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join("\\n");
  const scope = date + "/" + region + "/s3/aws4_request";
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequ¶»§q«^