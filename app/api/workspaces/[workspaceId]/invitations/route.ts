import {createHash,randomBytes} from "node:crypto";
import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
type Ctx={params:Promise<{workspaceId:string}>};
async function authorize(workspaceId:string){
 const supabase=await createClient(),{data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return {response:NextResponse.json({error:"Authentication required."},{status:401,headers})};
 const [{data:workspace,error:workspaceError},{data:member,error:memberError}]=await Promise.all([
  supabase.from("workspaces").select("id,name,owner_id").eq("id",workspaceId).maybeSingle(),
  supabase.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle()
 ]);
 if(workspaceError||memberError) return {response:NextResponse.json({error:"Could not verify workspace permissions."},{status:503,headers})};
 const role=workspace?.owner_id===user.id?"owner":member?.role;
 if(!workspace||!role||!["owner","admin"].includes(role))return {response:NextResponse.json({error:"Workspace owner/admin access required."},{status:403,headers})};
 return {supabase,user,workspace,role};
}
export async function GET(_request:Request,ctx:Ctx){
 const {workspaceId}=await ctx.params;const a=await authorize(workspaceId);if("response"in a)return a.response;
 try{const admin=createAdminClient();const {data,error}=await admin.from("workspace_invitations").select("id,email,role,status,expires_at,created_at,accepted_at").eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(100);if(error)throw error;return NextResponse.json({invitations:data??[]},{headers});}
 catch(e){console.error("Workspace invitation list failed:",e);return NextResponse.json({error:"Could not load invitations."},{status:503,headers});}
}
export async function POST(request:Request,ctx:Ctx){
 const {workspaceId}=await ctx.params;const a=await authorize(workspaceId);if("response"in a)return a.response;
 try{
  const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>2048)return NextResponse.json({error:"Request too large."},{status:413,headers});
  let body:Record<string,unknown>;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
  const email=typeof body.email==="string"?body.email.trim().toLowerCase():"";
  const role=body.role==="admin"?"admin":"member";
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>320)return NextResponse.json({error:"Enter a valid email address."},{status:400,headers});
  if(role==="admin"&&a.role!=="owner")return NextResponse.json({error:"Only the workspace owner can invite administrators."},{status:403,headers});
  const token=randomBytes(32).toString("hex"),tokenHash=createHash("sha256").update(token).digest("hex");
  const admin=createAdminClient();
  const {data:securitySettings,error:securityError}=await admin.from("workspace_security_settings").select("allow_member_invites").eq("workspace_id",workspaceId).maybeSingle();
  if(securityError)throw securityError;
  if(a.role==="admin"&&securitySettings?.allow_member_invites===false)return NextResponse.json({error:"Workspace owner has disabled administrator invitations."},{status:403,headers});
  const {data:existing}=await admin.from("workspace_members").select("user_id").eq("workspace_id",workspaceId);
  const invitedUser=(existing??[]).some(m=>m.user_id===a.user.id);
  if(!invitedUser)return NextResponse.json({error:"Workspace membership required."},{status:403,headers});
  const {data:invite,error}=await admin.from("workspace_invitations").insert({
   workspace_id:workspaceId,email,role,token_hash:tokenHash,invited_by:a.user.id,
   expires_at:new Date(Date.now()+7*86400000).toISOString()
  }).select("id,email,role,status,expires_at,created_at").single();
  if(error)throw error;
  const inviteUrl=new URL("/invite/workspace?token="+token,request.url).toString();
  let emailSent=false;
  const resendKey=process.env.RESEND_API_KEY,from=process.env.RESEND_FROM_EMAIL;
  if(resendKey&&from){
   const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+resendKey,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject:"You are invited to an Aivanta workspace",text:"You have been invited to join "+a.workspace.name+" as "+role+".\n\nAccept the workspace invitation: "+inviteUrl+"\n\nThis link expires in 7 days."}),cache:"no-store"});
   emailSent=response.ok;
  }
  return NextResponse.json({invitation:invite,invite_url:inviteUrl,email_sent:emailSent},{status:201,headers});
 }catch(e){console.error("Workspace invitation create failed:",e);return NextResponse.json({error:"Could not create invitation."},{status:503,headers});}
}

export async function DELETE(request:Request,ctx:Ctx){
 const {workspaceId}=await ctx.params;const a=await authorize(workspaceId);if("response"in a)return a.response;
 const invitationId=new URL(request.url).searchParams.get("invitation_id");
 if(!invitationId)return NextResponse.json({error:"Invitation id is required."},{status:400,headers});
 try{
  const admin=createAdminClient();
  const {data,error}=await admin.from("workspace_invitations").update({status:"revoked"}).eq("id",invitationId).eq("workspace_id",workspaceId).eq("status","pending").select("id").maybeSingle();
  if(error)throw error;if(!data)return NextResponse.json({error:"Pending invitation not found."},{status:404,headers});
  return NextResponse.json({revoked:true},{headers});
 }catch(error){console.error("Workspace invitation revoke failed:",error);return NextResponse.json({error:"Could not revoke invitation."},{status:503,headers});}
}
