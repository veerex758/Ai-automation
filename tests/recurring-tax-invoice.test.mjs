import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const migration=await readFile(new URL("../supabase/migrations/20261114200000_aivanta_recurring_billing_tax_invoices.sql",import.meta.url),"utf8");
const lifecycle=await readFile(new URL("../supabase/migrations/20261114210000_aivanta_recurring_subscription_lifecycle.sql",import.meta.url),"utf8");
const recoveryMigration=await readFile(new URL("../supabase/migrations/20261123104500_aivanta_recurring_billing_recovery_and_consent.sql",import.meta.url),"utf8");
const stripeCheckout=await readFile(new URL("../app/api/billing/stripe/subscribe/route.ts",import.meta.url),"utf8");
const stripeWebhook=await readFile(new URL("../app/api/billing/stripe/subscription-webhook/route.ts",import.meta.url),"utf8");
const paystackAuthorize=await readFile(new URL("../app/api/billing/paystack/recurring/authorize/route.ts",import.meta.url),"utf8");
const paystackWebhook=await readFile(new URL("../app/api/billing/webhook/route.ts",import.meta.url),"utf8");
const paystackCron=await readFile(new URL("../app/api/internal/billing/paystack-renewals/route.ts",import.meta.url),"utf8");
const cancelRoute=await readFile(new URL("../app/api/billing/cancel/route.ts",import.meta.url),"utf8");
const paystackConsentUI=await readFile(new URL("../app/dashboard/billing/billing-paystack-mandate.tsx",import.meta.url),"utf8");
const stripeConsentUI=await readFile(new URL("../app/dashboard/billing/billing-stripe-subscription.tsx",import.meta.url),"utf8");
const invoice=await readFile(new URL("../app/api/billing/invoices/[paymentId]/issue/route.ts",import.meta.url),"utf8");
const invoiceDocument=await readFile(new URL("../app/api/billing/invoice-docs/[invoiceId]/route.ts",import.meta.url),"utf8");
const cron=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));

test("recurring billing and invoice data are service-role protected and RLS enabled",()=>{
 for(const table of ["workspace_billing_customers","billing_recurring_events","billing_invoices","billing_tax_rules"])
  assert.match(migration,new RegExp("alter table public\\."+table+" enable row level security"));
 assert.match(migration,/revoke all on public\.workspace_billing_customers[\s\S]*from public,anon,authenticated/);
 assert.match(migration,/billing_invoices_payment_uidx/);
});

test("Stripe recurring checkout only uses approved server recurring prices",()=>{
 assert.match(stripeCheckout,/mode:"subscription"/);
 assert.match(stripeCheckout,/price\.type!=="recurring"/);
 assert.match(stripeCheckout,/price\.unit_amount!==plan\.amountMinor/);
 assert.match(stripeCheckout,/subscription_data:\{metadata/);
 assert.match(stripeCheckout,/canManageWorkspaceBilling/);
});

test("Stripe recurring webhook verifies signature and processes invoice paid, failure and cancellation",()=>{
 assert.match(stripeWebhook,/constructEvent/);
 assert.match(stripeWebhook,/invoice\.paid/);
 assert.match(stripeWebhook,/invoice\.payment_failed/);
 assert.match(stripeWebhook,/customer\.subscription\.deleted/);
 assert.match(stripeWebhook,/billing_recurring_events/);
 assert.match(stripeWebhook,/settle_workspace_payment/);
 assert.match(stripeWebhook,/invoice\.parent/);
 assert.match(stripeWebhook,/parent\.type!=="subscription_details"/);
 assert.match(stripeWebhook,/item\.current_period_start/);
 assert.match(stripeWebhook,/item\.current_period_end/);
 assert.doesNotMatch(stripeWebhook,/invoice\.subscription===/);
 assert.doesNotMatch(stripeWebhook,/subscription\.current_period_(?:start|end)/);
});

test("Paystack recurring setup requires authenticated manager and encrypted reusable authorization",()=>{
 assert.match(paystackAuthorize,/canManageWorkspaceBilling/);
 assert.match(paystackAuthorize,/recurring_setup:true/);
 assert.match(paystackWebhook,/authorization\.reusable!==true/);
 assert.match(paystackWebhook,/encryptWebhookSecret/);
 assert.match(paystackWebhook,/paystack_authorization_code_enc/);
});

test("recurring consents are private, versioned and bounded to a plan and amount",()=>{
 assert.match(recoveryMigration,/create table if not exists public\.billing_recurring_consents/);
 assert.match(recoveryMigration,/status in \('pending','active','revoked','failed'\)/);
 assert.match(recoveryMigration,/terms_version text not null/);
 assert.match(recoveryMigration,/revoke all on public\.billing_recurring_consents from public, anon, authenticated/);
 assert.match(paystackAuthorize,/body\.consent!==true/);
 assert.match(paystackAuthorize,/CONSENT_TERMS_VERSION/);
 assert.match(paystackAuthorize,/recurring_consent_id:consent\.id/);
 assert.match(stripeCheckout,/body\.consent!==true/);
 assert.match(stripeCheckout,/recurring_consent_id:consent\.id/);
 assert.match(stripeWebhook,/billing_recurring_consents/);
 assert.match(paystackWebhook,/billing_recurring_consents/);
});

test("both auto-renewal checkout controls require an unchecked-by-default consent checkbox",()=>{
 for(const ui of [paystackConsentUI,stripeConsentUI]){
  assert.match(ui,/useState\(false\)/);
  assert.match(ui,/type="checkbox"/);
  assert.match(ui,/checked=\{consented\}/);
  assert.match(ui,/disabled=\{!enabled\|\|busy\|\|!consented\}/);
  assert.match(ui,/consent:true/);
  assert.match(ui,/amountMinor/);
  assert.match(ui,/cadence/);
 }
});

test("Paystack retries have capped attempts, backoff and provider-verification before another charge",()=>{
 assert.match(recoveryMigration,/attempt_count integer not null default 0 check \(attempt_count between 0 and 3\)/);
 assert.match(recoveryMigration,/retry_after timestamptz not null default now\(\)/);
 assert.match(recoveryMigration,/claim_paystack_recurring_renewal/);
 assert.match(recoveryMigration,/finish_paystack_recurring_renewal/);
 assert.match(recoveryMigration,/retry_paystack_recurring_renewal/);
 assert.match(paystackCron,/transaction\/verify\//);
 assert.match(paystackCron,/claim_paystack_recurring_renewal/);
 assert.match(paystackCron,/finish_paystack_recurring_renewal/);
 assert.match(paystackCron,/complete_paystack_recurring_renewal/);
 assert.ok(paystackCron.indexOf("finish_paystack_recurring_renewal")<paystackCron.indexOf("transaction/charge_authorization"));
 assert.match(paystackCron,/PAYSTACK_CONFIRMATION_TIMEOUT/);
});

test("Paystack webhook completes successful renewal jobs and retries confirmed failed charges",()=>{
 assert.match(paystackWebhook,/charge\.failed/);
 assert.match(paystackWebhook,/retry_paystack_recurring_renewal/);
 assert.match(paystackWebhook,/complete_paystack_recurring_renewal/);
 assert.match(paystackWebhook,/auto_renew:true/);
 assert.match(paystackWebhook,/recurring_interval:interval/);
});

test("cancellation disables provider renewal before the local cancellation is reported",()=>{
 assert.match(cancelRoute,/customer\/authorization\/deactivate/);
 assert.match(cancelRoute,/stripe\.subscriptions\.update/);
 assert.match(cancelRoute,/request_workspace_subscription_cancellation/);
 assert.ok(cancelRoute.indexOf("customer/authorization/deactivate")<cancelRoute.indexOf("request_workspace_subscription_cancellation"));
 assert.ok(cancelRoute.indexOf("stripe.subscriptions.update")<cancelRoute.indexOf("request_workspace_subscription_cancellation"));
 assert.match(cancelRoute,/recurring_enabled:false/);
 assert.match(cancelRoute,/status:"revoked"/);
});

test("Paystack renewal scheduler remains cron protected",()=>{
 assert.match(paystackCron,/headers\.get\("authorization"\)!=="Bearer "\+cron/);
 assert.ok(cron.schedules["paystack-recurring-renewals"]?.path==="/api/internal/billing/paystack-renewals");
});

test("invoice document uses the shared workspace permission implementation",()=>{
 assert.match(invoiceDocument,/import\s+\{\s*hasWorkspacePermission\s*\}\s+from\s+"@\/lib\/supabase\/permissions"/);
 assert.doesNotMatch(invoiceDocument,/import\s+\{[^}]*hasWorkspacePermission[^}]*\}\s+from\s+"@\/lib\/supabase\/workspace"/);
});

test("tax invoice issuance requires legal seller settings and paid transaction; snapshots tax and customer",()=>{
 assert.match(invoice,/payment\.status!=="success"/);
 assert.match(invoice,/AIVANTA_LEGAL_ENTITY_NAME/);
 assert.match(invoice,/AIVANTA_TAX_JURISDICTION/);
 assert.match(invoice,/rate_basis_points/);
 assert.match(invoice,/tax_rule_snapshot/);
 assert.match(invoice,/next_workspace_invoice_number/);
 assert.match(invoice,/billing_invoices/);
 assert.match(lifecycle,/next_workspace_invoice_number/);
});
