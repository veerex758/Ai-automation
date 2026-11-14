import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
export const dynamic="force-dynamic";
export async function POST(request:Request){
 try{
  const supabase=await createClient(),{data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)return NextResponse.json({error:"Sign in before accepting this invitation."},{status:401});
  if(!user.email)return NextResponse.json({error:"Your account needs a verified email address."},{status:400});
  const body=await request.json() as {token?:unknown};
  const token=typeof body.token==="string"?body.token:"";
  if(!/^[a-f0-9]{64}$/.test(token))return NextResponse.json({error:"Invitation link is invalid."},{status:400});
  const tokenHash=createHash("sha256").update(token).digest("hex"),admin=createAdminClient();
  const {data,error}=await admin.rpc("accept_workspace_invitation",{p_token_hash:tokenHash,p_user_id:user.id,p_email:user.email});
  if(error)throw error;
  if(!data?.accepted){
   const message=data?.reason==="email_mismatch"?"Sign in with the email address that received this invitation.":data?.reason==="expired"?"This invitation has expired. Ask the workspace owner for a new link.":"This invitation is invalid, revoked or already used.";
   return NextResponse.json({error:message},{status:409});
  }
  const {data:workspace,error:workspaceError}=await supabase.from("workspaces").select("id,name").eq("id",data.workspace_id).single();
  if(workspaceError||!workspace)throw new Error("Accepted workspace could not be loaded.");
  const response=NextResponse.json({accepted:true,workspace},{headers:{"Cache-Control":"private, no-store"}});
  response.cookies.set("aivanta_active_workspace",workspace.id,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:60*60*24*365});
  return response;
 }catch(error){console.error("Workspace invitation acceptance failed:",error);return NextResponse.json({error:"Could not accept invitation."},{status:503});}
}
