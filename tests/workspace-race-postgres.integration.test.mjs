import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const databaseUrl = process.env.TEST_DATABASE_URL;
const migration = readFileSync(
  new URL("../supabase/migrations/20261014010000_aivanta_workspace_race_safe_default.sql", import.meta.url),
  "utf8",
);

const bootstrapSql = `
do $$ begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema auth;
create schema private;
create table auth.users (id uuid primary key);

create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create function auth.jwt() returns jsonb
language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null check (char_length(trim(name)) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create function private.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select auth.uid() is not null and (
  exists(select 1 from public.workspaces w where w.id = target_workspace_id and w.owner_id = auth.uid())
  or exists(select 1 from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid())
) $$;

create function private.is_workspace_owner(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select auth.uid() is not null and exists(
  select 1 from public.workspaces w where w.id = target_workspace_id and w.owner_id = auth.uid()
) $$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.is_workspace_owner(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;
grant usage on schema public, auth, private to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using (private.is_workspace_member(id));
create policy workspace_insert on public.workspaces for insert to authenticated with check (owner_id = (select auth.uid()));
create policy membership_read on public.workspace_members for select to authenticated using (private.is_workspace_member(workspace_id));
create policy membership_insert on public.workspace_members for insert to authenticated with check (private.is_workspace_owner(workspace_id));
grant select, insert on public.workspaces to authenticated;
grant select, insert on public.workspace_members to authenticated;
`;

test("workspace recovery migration replays and is safe under authenticated concurrent calls", { skip: !databaseUrl }, async () => {
  const adminUrl = new URL(databaseUrl);
  const originalDb = decodeURIComponent(adminUrl.pathname.replace(/^\//, ""));
  const databaseName = `aivanta_workspace_test_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const admin = new Client({ connectionString: databaseUrl });
  let client;
  let secondClient;

  await admin.connect();
  try {
    await admin.query(`create database "${databaseName}"`);
    adminUrl.pathname = `/${databaseName}`;
    const isolatedUrl = adminUrl.toString();
    client = new Client({ connectionString: isolatedUrl });
    secondClient = new Client({ connectionString: isolatedUrl });
    await Promise.all([client.connect(), secondClient.connect()]);

    await client.query(bootstrapSql);
    await client.query(migration);

    const userId = randomUUID();
    await client.query("insert into auth.users (id) values ($1)", [userId]);

    async function callAsAuthenticated(db) {
      await db.query("begin");
      try {
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
        await db.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: userId, user_metadata: { full_name: "Aivanta Test" } }),
        ]);
        const result = await db.query("select * from public.get_or_create_default_workspace()");
        await db.query("commit");
        return result.rows[0];
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    const [first, second] = await Promise.all([
      callAsAuthenticated(client),
      callAsAuthenticated(secondClient),
    ]);
    assert.equal(first.id, second.id, "concurrent requests must resolve to one default workspace");
    assert.equal(first.name, "Aivanta Test's workspace");

    const membershipCount = await client.query(
      "select count(*)::int as count from public.workspace_members where workspace_id = $1 and user_id = $2",
      [first.id, userId],
    );
    assert.equal(membershipCount.rows[0].count, 1, "owner membership must exist exactly once");

    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', '', true)");
    await assert.rejects(
      client.query("select * from public.get_or_create_default_workspace()"),
      /Authentication required/,
    );
    await client.query("rollback");
  } finally {
    if (secondClient) await secondClient.end().catch(() => {});
    if (client) await client.end().catch(() => {});
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1",
      [databaseName],
    ).catch(() => {});
    await admin.query(`drop database if exists "${databaseName}"`).catch(() => {});
    await admin.end();
  }
});
