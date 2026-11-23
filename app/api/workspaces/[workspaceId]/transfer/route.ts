import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:Request,ctx:{params:Promise<{workspaceId:string}>}){
 try{
  const origin=request.headers.get("origin"),referer=request.headers.get("referer");let sourceOrigin:string|null=origin;if(!sourceOrigin&&referer){try{sourceOrigin=new URL(referer).origin;}catch{sourceOrigin=null;}}if(sourceOrigin!==new URL(request.url).origin)return NextResponse.json({error:"Invalid origin."},{status:403,headers});
  const supabase=await createClient(),{data:{user},error}=await supabase.auth.getUser();
  if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const {workspaceId}=await ctx.params;
  if(!uuidPattern.test(workspaceId))return NextResponse.json({error:"Invalid workspace ID."},{status:400,headers});
  const {data:workspace,error:workspaceError}=await supabase.from("workspaces").select("id,owner_id").eq("id",workspaceId).maybeSingle();
  if(workspaceError)throw workspaceError;
  if(!workspace||workspace.owner_id!==user.id)return NextResponse.json({error:"Only the current workspace owner can transfer ownership."},{status:403,headers});
  const contentLength=Number(request.headers.get("content-length")??"0");if(contentLength>4096||new TextEncoder().encode(await request.clone().text()).byteLength>4096)return NextResponse.json({error:"Ownership transfer request exceeds 4 KiB."},{status:413,headers});
  const body=await request.json() as {new_owner_id?:unknown};
  if(typeof body.new_owner_id!=="string"||!uuidPattern.test(body.new_owner_id)||body.new_owner_id===user.id)return NextResponse.json({error:"Choose a different existing workspace member."},{status:400,headers});
  const admin=createAdminClient();
  const {data:result,error:transferError}=await admin.rpc("transfer_workspace_ownership",{p_workspace_id:workspaceId,p_new_owner_id:body.new_owner_id});
  if(transferError)throw transferError;
  return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){console.error("Workspace ownership transfer failed:",error);return NextResponse.json({error:"Could not transfer workspace ownership."},{status:503,headers});}
}
