"use client";

import { useState } from "react";
import { officialBrandAssets } from "@/lib/integrations/official-brand-assets";

const BRAND_TINTS: Record<string, string> = {
  openai: "10A37F", gemini: "8E75B2", slack: "611F69", resend: "111827",
  gmail: "EA4335", google_sheets: "34A853", sheets: "34A853", google_drive: "4285F4",
  google_calendar: "4285F4", google_docs: "4285F4", google_forms: "7248B9",
  youtube: "FF0033", google_contacts: "4285F4", notion: "111827", hubspot: "FF7A59",
  twilio_sms: "F22F46", twilio_voice: "F22F46", shopify: "7AB55C", stripe: "635BFF",
  linear: "5E6AD2", claude: "D97757", mistral: "F97316", groq: "F55036",
  perplexity: "20B8CD", elevenlabs: "F1F5F9", stability_ai: "7C3AED",
  hugging_face: "FBBF24", pinecone: "16A085", discord: "5865F2", telegram: "229ED9",
  whatsapp_business: "25D366", microsoft_teams: "6264A7", sendgrid: "1A82E2",
  mailgun: "F06B66", postmark: "FFDE00", salesforce: "00A1E0", pipedrive: "1A1A1A",
  zoho_crm: "E42527", freshsales: "F26522", close: "4F46E5", apollo: "5B61F6",
  intercom: "286EFA", jira: "2684FF", asana: "F06A6A", trello: "0052CC",
  clickup: "8930FD", monday: "FFCB00", todoist: "E44332", airtable: "18BFFF",
  github: "111827", gitlab: "FC6D26", bitbucket: "0052CC", sentry: "362D59",
  vercel: "111827", netlify: "32B5A4", supabase: "3ECF8E", postgresql: "4169E1",
  mysql: "4479A1", mongodb: "47A248", redis: "D82C20", firebase: "FFCA28",
  dropbox: "0061FF", aws_s3: "FF9900", cloudflare_r2: "F38020",
  woocommerce: "96588A", paypal: "003087", paddle: "7B61FF",
  lemon_squeezy: "FFC233", square: "111827", razorpay: "0C2451",
  x_twitter: "111827", linkedin: "0A66C2", facebook_pages: "0866FF",
  instagram: "E1306C", tiktok: "111827", mailchimp: "FFE01B",
  typeform: "262627", calendly: "006BFF", zendesk: "03363D",
  freshdesk: "25C16F", zoom: "2D8CFF", cal_com: "292929",
  docusign: "2463A6", rss_feed: "F26522", serpapi: "4D8BFF",
  openweather: "EB6E4B",
};


function PrimitiveMark({ providerId, nodeType, iconName }: { providerId: string; nodeType: string; iconName?: string }) {
  const id = providerId || iconName || "";
  const tint = id === "if" || id === "switch" || nodeType === "condition" ? "branch" : nodeType;
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let drawing: import("react").ReactNode;
  if (["webhooks", "webhook_trigger", "webhook"].includes(id)) {
    drawing = <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="2.2" /><path d="M9 6h3a4 4 0 0 1 4 4v5M6 9v3a4 4 0 0 0 4 4h5" /></svg>;
  } else if (["email", "mail"].includes(id)) {
    drawing = <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><rect x="3" y="5" width="18" height="14" rx="2.4" /><path d="m4.5 7 7.5 6 7.5-6" /></svg>;
  } else if (["if", "switch"].includes(id) || nodeType === "condition") {
    drawing = <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="m12 2.8 8.4 9.2-8.4 9.2L3.6 12 12 2.8Z" /><path d="M12 7v5m0 0 4 4m-4-4-4 4" /></svg>;
  } else if (["schedule", "schedule_cron"].includes(id)) {
    drawing = <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><rect x="3" y="4.5" width="18" height="17" rx="2.5" /><path d="M7.5 2.5v4M16.5 2.5v4M3 9h18m-9 3v4l2.5 1.5" /></svg>;
  } else if (["manual", "manual_trigger"].includes(id)) {
    drawing = <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="m8 5 11 7-11 7V5Z" /></svg>;
  } else if (["http_request", "http", "api"].includes(id)) {
    drawing = <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M4 8h14m-4-4 4 4-4 4M20 16H6m4-4-4 4 4 4" /></svg>;
  } else if (["database", "data", "postgres", "sql"].includes(id)) {
    drawing = <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
  } else if (["javascript", "code_js", "code"].includes(id) || iconName === "code") {
    drawing = <span className="graph-node-code-mark" aria-hidden="true">{"</>"}</span>;
  } else if (["loop", "repeat"].includes(id)) {
    drawing = <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M20 7v5h-5M4 17v-5h5M5 9a7 7 0 0 1 12-2l3 5M4 12l3 5a7 7 0 0 0 12-2" /></svg>;
  } else {
    drawing = <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M7 7h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8Zm5 0V4m0 11v5" /></svg>;
  }
  return <span className={"graph-node-primitive graph-node-primitive-" + tint} aria-hidden="true">{drawing}</span>;
}

export default function GraphNodeBrand({
  providerId, providerName, providerIcon, nodeType,
}: {
  providerId: string;
  providerName: string;
  providerIcon?: string;
  nodeType: "trigger" | "action" | "condition";
}) {
  const [failed, setFailed] = useState(false);
  const asset = officialBrandAssets[providerId] || (providerId === "email" ? officialBrandAssets.resend : undefined);
  const tint = BRAND_TINTS[providerId] || (providerId === "email" ? BRAND_TINTS.resend : "64748B");
  const logoName = providerId === "email" ? "Resend" : providerName;
  return <span className={`graph-node-brand ${asset && !failed ? "has-brand-asset" : "has-primitive-mark"}`}>
    {asset && !failed ? (
      <img
        src={`https://cdn.simpleicons.org/${asset.slug}/${tint}`}
        alt={`${logoName} logo`}
        loading="eager"
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    ) : (
      <PrimitiveMark providerId={providerId} nodeType={nodeType} iconName={providerIcon} />
    )}
  </span>;
}
