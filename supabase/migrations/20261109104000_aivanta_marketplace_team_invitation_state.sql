alter table public.marketplace_creator_team_members add column if not exists invitation_status text not null default 'active' check(invitation_status in ('pending','active','declined'));
create index if not exists marketplace_creator_team_invites_idx on public.marketplace_creator_team_members(user_id,invitation_status,joined_at);
