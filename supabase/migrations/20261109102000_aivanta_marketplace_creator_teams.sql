-- Phase C: creator agency teams, membership and product collaboration.
create table if not exists public.marketplace_creator_teams (
 id uuid primary key default gen_random_uuid(), owner_creator_id uuid not null references public.marketplace_creators(id) on delete restrict,
 name varchar(120) not null check(char_length(trim(name)) between 1 and 120),
 slug varchar(120) not null check(slug ~ '^[a-z0-9-]+$'), status text not null default 'active' check(status in ('active','suspended')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_creator_id,slug)
);
create table if not exists public.marketplace_creator_team_members (
 team_id uuid not null references public.marketplace_creator_teams(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('admin','editor','analyst')), invited_by uuid not null references auth.users(id) on delete restrict,
 joined_at timestamptz not null default now(), primary key(team_id,user_id)
);
create table if not exists public.marketplace_product_collaborators (
 product_id uuid not null references public.marketplace_products(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('editor','analyst')), granted_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(product_id,user_id)
);
alter table public.marketplace_products add column if not exists creator_team_id uuid references public.marketplace_creator_teams(id) on delete set null;
create index if not exists marketplace_creator_team_members_user_idx on public.marketplace_creator_team_members(user_id,team_id);
alter table public.marketplace_creator_teams enable row level security;alter table public.marketplace_creator_team_members enable row level security;alter table public.marketplace_product_collaborators enable row level security;
revoke all on public.marketplace_creator_teams,public.marketplace_creator_team_members,public.marketplace_product_collaborators from anon,authenticated;
grant select on public.marketplace_creator_teams,public.marketplace_creator_team_members,public.marketplace_product_collaborators to authenticated;
-- Team ownership/admin writes are performed through the authenticated, owner-checked server API (service role); members can read their own team records.
create policy marketplace_creator_team_member_read on public.marketplace_creator_teams for select to authenticated using (
 exists(select 1 from public.marketplace_creators c where c.id=owner_creator_id and c.user_id=auth.uid())
 or exists(select 1 from public.marketplace_creator_team_members m where m.team_id=id and m.user_id=auth.uid())
);
create policy marketplace_creator_team_members_read on public.marketplace_creator_team_members for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.marketplace_creators c join public.marketplace_creator_teams t on t.owner_creator_id=c.id where t.id=team_id and c.user_id=auth.uid()));
create policy marketplace_product_collaborators_read on public.marketplace_product_collaborators for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.marketplace_products p join public.marketplace_creators c on c.id=p.creator_id where p.id=product_id and c.user_id=auth.uid()));
