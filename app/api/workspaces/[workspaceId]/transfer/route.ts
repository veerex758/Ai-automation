import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
export const dynamic="force-dynamic";
export async function POST(request:Request,ctx:{params:Promise<{workspaceId:string}>}){
 try{
  const supabase=await createClient(),{data:{user},error}=await supabase.auth.getUser();
  if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401});
  const {workspaceId}=await ctx.params;
  const {data:workspace,error:workspaceError}=await supabase.from("workspaces").select("id,owner_id").eq("id",workspaceId).maybeSingle();
  if(workspaceError)throw workspaceError;
  if(!workspace||workspace.owner_id!==user.id)return NextResponse.json({error:"Only the current workspace owner can transfer ownership."},{status:403});
  const body=await request.json() as {new_owner_id?:unknown};
  if(typeof body.new_owner_id!=="string"||body.new_owner_id===user.id)return NextResponse.json({error:"Choose a different existing workspace member."},{status:400});
  const admin=createAdminClient();
  const {data:result,error:transferError}=await admin.rpc("transfer_workspace_ownership",{p_workspace_id:workspaceId,p_new_owner_id:body.new_owner_id});
  if(transferError)throw transferError;
  return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){console.error("Workspace ownership transfer failed:",error);return NextResponse.json({error:"Could not transfer workspace ownership."},{status:503});}
}
