import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(request:NextRequest){
 try{const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const workspace=await getOrCreateDefaultWorkspace(supabase);const params=request.nextUrl.searchParams;const state=params.get("status");
 let query=supabase.from("real_estate_followups").select("id,lead_id,sequence,channel,due_at,status,subject,sent_at,last_error_code,attempt_count,max_attempts").eq("workspace_id",workspace.id).order("due_at",{ascending:true}).limit(200);
 if(state&&["pending","sending","sent","failed","cancelled"].includes(state))query=query.eq("status",state);
 const {data,error}=await query;if(error)throw error;
 const leadIds=[...new Set((data??[]).map(f=>f.lead_id))];
 const {data:leads, error:leadError}=leadIds.length?await supabase.from("real_estate_leads").select("id,full_name,email,status,lead_score,consent_to_contact,customer_responded_at,agent_takeover_at").in("id",leadIds).eq("workspace_id",workspace.id):{data:[],error:null};
 if(leadError)throw leadError;const byId=new Map((leads??[]).map(l=>[l.id,l]));
 return NextResponse.json({followups:(data??[]).map(f=>({...f,lead:byId.get(f.lead_id)??null}))},{headers});
 }catch(error){console.error("Real-estate followups list failed",error);return NextResponse.json({error:"Could not load follow-ups."},{status:500,headers});}
}
