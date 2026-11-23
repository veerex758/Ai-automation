import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
type Ctx={params:Promise<{workspaceId:string}>};
async function authorize(workspaceId:string){
 const supabase=await createClient(),{data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return {response:NextResponse.json({error:"Authentication required."},{status:401,headers})};
 const [{data:workspace,error:we},{data:member,error:me}]=await Promise.all([
  supabase.from("workspaces").select("id,name,owner_id").eq("id",workspaceId).maybeSingle(),
  supabase.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle()
 ]);
 if(we||me)return {response:NextResponse.json({error:"Could not verify workspace."},{status:503,headers})};
 const role=workspace?.owner_id===user.id?"owner":member?.role;
 if(!workspace||!role||!["owner","admin"].includes(role))return {response:NextResponse.json({error:"Workspace owner/admin access required."},{status:403,headers})};
 return {supabase,user,workspace,role};
}
export async function GET(_request:Request,ctx:Ctx){
 const {workspaceId}=await ctx.params,a=await authorize(workspaceId);if("response"in a)return a.response;
 try{
  const admin=createAdminClient();const {data,error}=await admin.from("workspace_security_settings").select("allow_member_invites,require_approval_for_live_actions,updated_at").eq("workspace_id",workspaceId).maybeSingle();
  if(error)throw error;
  return NextResponse.json({settings:data??{allow_member_invites:true,require_approval_for_live_actions:true}},{headers});
 }catch(error){console.error("Workspace security settings read failed:",error);return NextResponse.json({error:"Could not load security settings."},{status:503,headers});}
}
export async function PATCH(request:Request,ctx:Ctx){
 const {workspaceId}=await ctx.params,a=await authorize(workspaceId);if("response"in a)return a.response;
 if(a.role!=="owner")return NextResponse.json({error:"Only the workspace owner can change security policies."},{status:403,headers});
 try{
  const body=await request.json() as {allow_member_invites?:unknown};
  if(typeof body.allow_member_invites!=="boolean")return NextResponse.json({error:"allow_member_invites must be boolean."},{status:400,headers});
  const admin=createAdminClient();
  const {data,error}=await admin.from("workspace_security_settings").upsert({
   workspace_id:workspaceId,allow_member_invites:body.allow_member_invites,
   require_approval_for_live_actions:true,updated_by:a.user.id,updated_at:new Date().toISOString()
  },{onConflict:"workspace_id"}).select("allow_member_invites,require_approval_for_live_actions,updated_at").single();
  if(error)throw error;
  await admin.from("audit_events").insert({workspace_id:workspaceId,actor_user_id:a.user.id,event_type:"workspace.security_policy_updated",resource_type:"workspace_security_settings",resource_id:workspaceId,metadata:{allow_member_invites:body.allow_member_invites}});
  return NextResponse.json({settings:data},{headers});
 }catch(error){console.error("Workspace security settings update failed:",error);return NextResponse.json({error:"Could not update security settings."},{status:503,headers});}
}
