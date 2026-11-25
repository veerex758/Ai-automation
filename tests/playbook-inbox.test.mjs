import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api=readFileSync(new URL("../app/api/real-estate/playbooks/inbox/route.ts",import.meta.url),"utf8");
const action=readFileSync(new URL("../app/api/real-estate/playbooks/inbox/[decisionId]/route.ts",import.meta.url),"utf8");
const migration=readFileSync(new URL("../supabase/migrations/20261124125748_rexnora_playbook_policy_inbox.sql",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/dashboard/playbooks/[playbookId]/inbox/page.tsx",import.meta.url),"utf8");

test("Decision Inbox is workspace-scoped and displays only decisions for the selected Playbook",()=>{
 assert.match(api,/\.eq\("workspace_id",workspace\.id\)/);
 assert.match(api,/\.eq\("workflow_id",workflowId\)/);
 assert.match(api,/real_estate_playbook_decisions/);
 assert.match(api,/real_estate_leads/);
});

test("Decision resolution requires execute permission and uses the atomic service RPC",()=>{
 assert.match(action,/workflows\.execute/);
 assert.match(action,/resolve_real_estate_playbook_decision/);
 assert.match(migration,/for update/);
 assert.match(migration,/status='pending'/);
 assert.match(migration,/workflow_row\.version <> decision_row\.workflow_version/);
});

test("Inbox approval is not a direct provider execution and explicitly requeues work",()=>{
 assert.match(page,/Approve & resume/);
 assert.match(page,/Credentials, consent, connection validation and idempotency/);
 assert.doesNotMatch(action,/send_email|fetch\("https?:/);
});

test("decision records are private to workspace members and only service role writes them",()=>{
 assert.match(migration,/enable row level security/);
 assert.match(migration,/private\.is_workspace_member\(workspace_id\)/);
 assert.match(migration,/revoke all on public\.real_estate_playbook_decisions from anon, authenticated/);
 assert.match(migration,/grant all on public\.real_estate_playbook_decisions to service_role/);
});
