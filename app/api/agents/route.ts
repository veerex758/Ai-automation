import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { getAgentTools } from "@/lib/agents/tool-runtime";

const headers={"Cache-Control":"private, no-store"};
const toolPattern=/^[a-z][a-z0-9._:-]{0,79}$/;
function cleanAgent(input: unknown) {
 if(!input||typeof input!=="object") return {error:"Agent data must be an object."};
 const v=input as Record<string,unknown>;
 const name=typeof v.name==="string"?v.name.trim():"";
 const description=typeof v.description==="string"?v.description.trim():"";
 const instructions=typeof v.instructions==="string"?v.instructions.trim():"";
 const provider=v.model_provider==="openai"?"openai":"gemini";
 const model=typeof v.model_name==="string"?v.model_name.trim():(provider==="openai"?"gpt-4o-mini":"gemini-2.5-flash");
 const tools=Array.isArray(v.tool_ids)?v.tool_ids:[];
 if(name.length<1||name.length>80)return {error:"Agent name must be 1–80 characters."};
 if(description.length>500)return {error:"Description cannot exceed 500 characters."};
 if(instructions.length>12000)return {error:"Instructions cannot exceed 12,000 characters."};
 if(model.length<1||model.length>120)return {error:"Model name must be 1–120 characters."};
 if(tools.length>30||tools.some(x=>typeof x!=="string"||!toolPattern.test(x)))return {error:"Select up to 30 valid tool identifiers."};
 try { getAgentTools(tools as string[]); } catch { return {error:"Choose only approved read-only tools: workflow.list, workflow.get, integrations.list."}; }
 const status=v.status==="paused"?"paused":v.status==="ready"?"ready":"draft";
 return {value:{name,description,instructions,model_provider:provider,model_name:model,tool_ids:[...new Set(tools as string[])],permissions:{mode:status==="ready"?"read_only":"draft",allow_external_actions:false},status}};
}
async function auth(){
 const supabase=await createClient();const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return {response:NextResponse.json({error:"Authentication required."},{status:401,headers})};
 const workspace=await getOrCreateDefaultWorkspace(supabase);return {supabase,user,workspace};
}
export async function GET(){
 try{const a=await auth();if("response"in a)return a.response;
 const {data:agents,error}=await a.supabase.from("agents").select("id,name,description,instructions,model_provider,model_name,tool_ids,permissions,status,created_at,updated_at").eq("workspace_id",a.workspace.id).order("updated_at",{ascending:false});
 if(error)throw error;
 const {data:activity}=await a.supabase.from("agent_activity").select("id,agent_id,event_type,details,created_at").eq("workspace_id",a.workspace.id).order("created_at",{ascending:false}).limit(50);
 return NextResponse.json({agents:agents??[],activity:activity??[]},{headers});
 }catch(e){console.error("Agent list failed",e);return NextResponse.json({error:"Could not load agents."},{status:500,headers});}
}
export async function POST(request:NextRequest){
 try{const a=await auth();if("response"in a)return a.response;
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>16384)return NextResponse.json({error:"Agent request exceeds 16 KiB."},{status:413,headers});
 let body:unknown;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Request must be valid JSON."},{status:400,headers});}
 const parsed=cleanAgent(body);if(parsed.error)return NextResponse.json({error:parsed.error},{status:400,headers});
 const {data,error}=await a.supabase.from("agents").insert({...parsed.value,workspace_id:a.workspace.id,created_by:a.user.id}).select("id,name,status,updated_at").single();if(error)throw error;
 await a.supabase.from("agent_activity").insert({workspace_id:a.workspace.id,agent_id:data.id,actor_user_id:a.user.id,event_type:"agent.created",details:{name:data.name}});
 return NextResponse.json({agent:data},{status:201,headers});
 }catch(e){console.error("Agent create failed",e);return NextResponse.json({error:"Could not create agent."},{status:500,headers});}
}
