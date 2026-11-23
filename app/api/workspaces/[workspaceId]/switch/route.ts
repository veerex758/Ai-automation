import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
 const origin=request.headers.get("origin"),referer=request.headers.get("referer");
 let sourceOrigin:string|null=origin;
 if(!sourceOrigin&&referer){try{sourceOrigin=new URL(referer).origin;}catch{sourceOrigin=null;}}
 if(sourceOrigin!==new URL(request.url).origin)return NextResponse.json({error:"Invalid origin."},{status:403,headers});
 const supabase=await createClient(),{data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const {workspaceId}=await context.params;
 if(!uuidPattern.test(workspaceId))return NextResponse.json({error:"Invalid workspace ID."},{status:400,headers});
 const {data:workspace,error:workspaceError}=await supabase.from("workspaces").select("id,name").eq("id",workspaceId).maybeSingle();
 if(workspaceError)return NextResponse.json({error:"Could not verify workspace access."},{status:503,headers});
 if(!workspace)return NextResponse.json({error:"Workspace not found or access denied."},{status:404,headers});
 const response=NextResponse.json({workspace},{headers});
 response.cookies.set("aivanta_active_workspace",workspace.id,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:60*60*24*365});
 return response;
}
