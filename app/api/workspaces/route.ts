import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {createClient} from "@/lib/supabase/server";
import {getOrCreateDefaultWorkspace} from "@/lib/supabase/workspace";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
function setActive(response:NextResponse,id:string){
 response.cookies.set("aivanta_active_workspace",id,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:60*60*24*365});
}
export async function GET(){
 try{
  const supabase=await createClient(),{data:{user},error}=await supabase.auth.getUser();
  if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const {data,error:listError}=await supabase.from("workspaces").select("id,name,owner_id,created_at").order("created_at",{ascending:true});
  if(listError)throw listError;
  const cookieStore=await cookies(),activeId=cookieStore.get("aivanta_active_workspace")?.value;
  const selected=(data??[]).find(w=>w.id===activeId)??await getOrCreateDefaultWorkspace(supabase);
  return NextResponse.json({workspaces:data??[],active_workspace_id:selected.id,user_id:user.id},{headers});
 }catch(error){console.error("Workspace list failed:",error);return NextResponse.json({error:"Could not load workspaces."},{status:503,headers});}
}
export async function POST(request:Request){
 try{
  const supabase=await createClient(),{data:{user},error}=await supabase.auth.getUser();
  if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>2048)return NextResponse.json({error:"Request too large."},{status:413,headers});
  let body:Record<string,unknown>;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
  const name=typeof body.name==="string"?body.name.trim():"";
  if(name.length<1||name.length>120)return NextResponse.json({error:"Workspace name must be 1–120 characters."},{status:400,headers});
  const {data,error:createError}=await supabase.rpc("create_workspace_for_current_user",{p_name:name});
  if(createError)throw createError;
  const workspace=Array.isArray(data)?data[0]:data;
  if(!workspace?.id||!workspace?.name)throw new Error("Workspace creation returned no workspace.");
  const response=NextResponse.json({workspace},{status:201,headers});setActive(response,workspace.id);return response;
 }catch(error){console.error("Workspace creation failed:",error);return NextResponse.json({error:"Could not create workspace."},{status:503,headers});}
}
