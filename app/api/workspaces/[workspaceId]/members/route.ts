import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {hasWorkspacePermission} from "@/lib/supabase/permissions";
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
 if(!workspace||!role||!(await hasWorkspacePermission(supabase,workspaceId,user.id,"members.manage")))return {response:NextResponse.json({error:"Workspace members.manage permission required."},{status:403,headers})};
 return {supabase,user,workspace,role};
}
export async function GET(_request:Request,ctx:Ctx){
 const {workspaceId}=await ctx.params;const a=await authorize(workspaceId);if("response"in a)return a.response;
 const admin=createAdminClient();const {data:members,error}=await admin.from("workspace_members").select("user_id,role,custom_role_id,created_at").eq("workspace_id",workspaceId).order("created_at",{ascending:true});
 if(error)return NextResponse.json({error:"Could not load workspace members."},{status:503,headers});
 const {data:users}=await admin.auth.admin.listUsers({page:1,perPage:1000});
 const mapped=(members??[]).map(m=>({user_id:m.user_id,role:m.role,custom_role_id:m.custom_role_id??null,joined_at:m.created_at,email:users?.users.find(u=>u.id===m.user_id)?.email??null}));
 return NextResponse.json({workspace:a.workspace,members:mapped},{headers});
}
export async function PATCH(request:Request,ctx:Ctx){
 const {workspaceId}=await ctx.params;const a=await authorize(workspaceId);if("response"in a)return a.response;
 try{
  const body=await request.json() as {user_id?:unknown;role?:unknown};
  if(typeof body.user_id!=="string"||!["admin","member"].includes(String(body.role)))return NextResponse.json({error:"Member and valid role are required."},{status:400,headers});
  if(body.role==="admin"&&a.role!=="owner")return NextResponse.json({error:"Only the workspace owner can grant administrator access."},{status:403,headers});
  const admin=createAdminClient();
  const {data:target,error:targetError}=await admin.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",body.user_id).maybeSingle();
  if(targetError)throw targetError;if(!target||target.role==="owner")return NextResponse.json({error:"The workspace owner role cannot be changed here."},{status:409,headers});
  if(target.role==="admin"&&a.role!=="owner")return NextResponse.json({error:"Only the owner can change an administrator."},{status:403,headers});
  const {error}=await admin.from("workspace_members").update({role:body.role}).eq("workspace_id",workspaceId).eq("user_id",body.user_id);
  if(error)throw error;
  return NextResponse.json({updated:true},{headers});
 }catch(e){console.error("Workspace member role update failed:",e);return NextResponse.json({error:"Could not update member role."},{status:503,headers});}
}
export async function DELETE(request:Request,ctx:Ctx){
 const {workspaceId}=await ctx.params;const a=await authorize(workspaceId);if("response"in a)return a.response;
 const userId=new URL(request.url).searchParams.get("user_id");
 if(!userId)return NextResponse.json({error:"Member user_id is required."},{status:400,headers});
 try{
  const admin=createAdminClient();const {data:target,error:targetError}=await admin.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",userId).maybeSingle();
  if(targetError)throw targetError;if(!target||target.role==="owner")return NextResponse.json({error:"Workspace owner cannot be removed."},{status:409,headers});
  if(target.role==="admin"&&a.role!=="owner")return NextResponse.json({error:"Only the owner can remove an administrator."},{status:403,headers});
  const {error}=await admin.from("workspace_members").delete().eq("workspace_id",workspaceId).eq("user_id",userId);
  if(error)throw error;return NextResponse.json({removed:true},{headers});
 }catch(e){console.error("Workspace member removal failed:",e);return NextResponse.json({error:"Could not remove member."},{status:503,headers});}
}
