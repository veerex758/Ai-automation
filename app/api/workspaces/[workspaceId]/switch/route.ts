import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
export const dynamic="force-dynamic";
export async function POST(_request:Request,context:{params:Promise<{workspaceId:string}>}){
 const supabase=await createClient(),{data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401});
 const {workspaceId}=await context.params;
 const {data:workspace,error:workspaceError}=await supabase.from("workspaces").select("id,name").eq("id",workspaceId).maybeSingle();
 if(workspaceError)return NextResponse.json({error:"Could not verify workspace access."},{status:503});
 if(!workspace)return NextResponse.json({error:"Workspace not found or access denied."},{status:404});
 const response=NextResponse.json({workspace},{headers:{"Cache-Control":"private, no-store"}});
 response.cookies.set("aivanta_active_workspace",workspace.id,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:60*60*24*365});
 return response;
}
