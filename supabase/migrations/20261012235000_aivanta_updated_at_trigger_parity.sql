-- Restore canonical updated_at triggers for workspaces and workflows.
-- The shared public.set_updated_at() trigger helper is already installed.
drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists workflows_set_updated_at on public.workflows;
create trigger workflows_set_updated_at
before update on public.workflows
for each row execute function public.set_updated_at();
