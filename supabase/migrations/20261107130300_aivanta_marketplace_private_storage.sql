-- Private marketplace package storage. Only authenticated creators may upload into their own prefix;
-- download access is mediated by server/service role after entitlement and verification checks.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('marketplace-artifacts','marketplace-artifacts',false,524288,'application/json')
on conflict(id) do update set public=false,file_size_limit=524288,allowed_mime_types=array['application/json'];
drop policy if exists marketplace_artifact_creator_upload on storage.objects;
create policy marketplace_artifact_creator_upload on storage.objects for insert to authenticated
with check (bucket_id='marketplace-artifacts' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists marketplace_artifact_creator_read on storage.objects;
create policy marketplace_artifact_creator_read on storage.objects for select to authenticated
using (bucket_id='marketplace-artifacts' and (storage.foldername(name))[1]=auth.uid()::text);
-- No anon/public download policy. Service role access is used for verification/install only.
