import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(){
 try{
  const supabase=await createClient();
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const workspace=await getOrCreateDefaultWorkspace(supabase);
  const {data:membership,error:memberError}=await supabase.from("workspace_members").select("role").eq("workspace_id",workspace.id).eq("user_id",user.id).maybeSingle();
  if(memberError)throw memberError;
  const {data:owner,error:ownerError}=await supabase.from("workspaces").select("owner_id").eq("id",workspace.id).maybeSingle();
  if(ownerError)throw ownerError;
  const role=owner?.owner_id===user.id?"owner":membership?.role;
  if(!role||!["owner","admin"].includes(role))return NextResponse.json({error:"Workspace owner or admin access required."},{status:403,headers});
  const admin=createAdminClient(),since=new Date(Date.now()-24*60*60*1000).toISOString();
  const [jobs,dead,workers,runs,integrations,queued,running,retry,waiting,succeeded,deadCount]=await Promise.all([
   admin.from("execution_jobs").select("id,status,attempts,max_attempts,worker_id,last_error_code,created_at,started_at,completed_at,lease_until").eq("workspace_id",workspace.id).order("created_at",{ascending:false}).limit(200),
   admin.from("execution_dead_letters").select("id,error_code,attempts,failed_at,replayed_at").eq("workspace_id",workspace.id).order("failed_at",{ascending:false}).limit(50),
   admin.from("execution_worker_heartbeats").select("worker_id,status,current_job_id,last_error_code,last_seen_at").order("last_seen_at",{ascending:false}).limit(20),
   admin.from("workflow_runs").select("id,status,duration_ms,created_at,error_message").eq("workspace_id",workspace.id).gte("created_at",since).limit(500),
   admin.from("workspace_integrations").select("provider,status,last_test_status,updated_at").eq("workspace_id",workspace.id),
   admin.from("execution_jobs").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id).eq("status","queued"),
   admin.from("execution_jobs").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id).eq("status","running"),
   admin.from("execution_jobs").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id).eq("status","retry_wait"),
   admin.from("execution_jobs").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id).eq("status","waiting"),
   admin.from("execution_jobs").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id).eq("status","succeeded"),
   admin.from("execution_jobs").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id).eq("status","dead_letter")
  ]);
  const problem=[jobs.error,dead.error,workers.error,runs.error,integrations.error,queued.error,running.error,retry.error,waiting.error,succeeded.error,deadCount.error].find(Boolean);
  if(problem)throw problem;
  const jobRows=jobs.data??[],runRows=runs.data??[];
  const counts={queued:queued.count??0,running:running.count??0,retry_wait:retry.count??0,waiting:waiting.count??0,succeeded:succeeded.count??0,dead_letter:deadCount.count??0};
  const durations=runRows.map(r=>r.duration_ms).filter((n):n is number=>typeof n==="number"&&n>=0);
  const avgLatency=durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null;
  const now=Date.now();
  const workerRows=(workers.data??[]).map(w=>({...w,health:now-Date.parse(w.last_seen_at)<120000?"healthy":now-Date.parse(w.last_seen_at)<600000?"stale":"offline"}));
  const providerFailures:Record<string,number>={};
  for(const job of jobRows){if(job.last_error_code){const key=String(job.last_error_code).split("_")[0].toLowerCase();providerFailures[key]=(providerFailures[key]??0)+1;}}
  return NextResponse.json({
   workspace_id:workspace.id,generated_at:new Date().toISOString(),
   queue:{...counts,observed_jobs:jobRows.length,oldest_queued_at:jobRows.filter(j=>j.status==="queued"||j.status==="retry_wait"||j.status==="waiting").at(-1)?.created_at??null},
   workers:workerRows,dead_letters:dead.data??[],
   performance:{runs_24h:runRows.length,average_latency_ms:avgLatency,failed_runs_24h:runRows.filter(r=>r.status==="failed").length},
   provider_failures:providerFailures,integrations:integrations.data??[],
   recent_jobs:jobRows.slice(0,30)
  },{headers});
 }catch(error){
  console.error("Operational monitoring failed:",error);
  return NextResponse.json({error:"Operational diagnostics are temporarily unavailable."},{status:503,headers});
 }
}
