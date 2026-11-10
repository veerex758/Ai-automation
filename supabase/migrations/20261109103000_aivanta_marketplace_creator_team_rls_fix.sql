-- Remove cross-table membership policy recursion; membership details are returned only through the authenticated owner-checked service API.
drop policy if exists marketplace_creator_team_member_read on public.marketplace_creator_teams;
drop policy if exists marketplace_creator_team_members_read on public.marketplace_creator_team_members;
create policy marketplace_creator_team_owner_read on public.marketplace_creator_teams for select to authenticated using (exists(select 1 from public.marketplace_creators c where c.id=owner_creator_id and c.user_id=auth.uid()));
create policy marketplace_creator_team_self_membership_read on public.marketplace_creator_team_members for select to authenticated using (user_id=auth.uid());
