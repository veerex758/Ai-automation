import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(){
 try{
  const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const workspace=await getOrCreateDefaultWorkspace(supabase);
  const count=async(table:string,filters:(q:any)=>any)=>{let q=supabase.from(table).select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id);q=filters(q);const {count,error}=await q;if(error)throw error;return count??0;};
  const [total,newLeads,qualified,hot,warm,cold,viewings,won,lost,properties,activeProperties,followupsDue,agents]=await Promise.all([
   count("real_estate_leads",q=>q),count("real_estate_leads",q=>q.eq("status","new")),count("real_estate_leads",q=>q.gte("lead_score",50)),
   count("real_estate_leads",q=>q.eq("lead_temperature","hot")),count("real_estate_leads",q=>q.eq("lead_temperature","warm")),count("real_estate_leads",q=>q.eq("lead_temperature","cold")),
   count("real_estate_leads",q=>q.eq("status","viewing_scheduled")),count("real_estate_leads",q=>q.eq("status","won")),count("real_estate_leads",q=>q.eq("status","lost")),
   count("real_estate_properties",q=>q),count("real_estate_properties",q=>q.eq("available",true)),
   count("real_estate_followups",q=>q.eq("status","pending").lte("due_at",new Date().toISOString())),count("agents",q=>q),
  ]);
  const [{data:recentLeads,error:recentError},{data:recentActivities,error:activityError},{data:sourceRows,error:sourceError}]=await Promise.all([
   supabase.from("real_estate_leads").select("id,full_name,email,phone,lead_score,lead_temperature,status,source,preferred_location,created_at").eq("workspace_id",workspace.id).order("created_at",{ascending:false}).limit(8),
   supabase.from("real_estate_lead_activities").select("id,lead_id,activity_type,details,created_at").eq("workspace_id",workspace.id).order("created_at",{ascending:false}).limit(12),
   supabase.from("real_estate_leads").select("source").eq("workspace_id",workspace.id).limit(1000),
  ]);
  if(recentError||activityError||sourceError)throw recentError??activityError??sourceError;
  const bySource=new Map<string,number>();for(const row of sourceRows??[])bySource.set(row.source,(bySource.get(row.source)??0)+1);
  return NextResponse.json({stats:{total,newLeads,qualified,hot,warm,cold,viewings,won,lost,properties,activeProperties,followupsDue,agents},sources:[...bySource].map(([source,count])=>({source,count})).sort((a,b)=>b.count-a.count),recentLeads:recentLeads??[],recentActivities:recentActivities??[]},{headers});
 }catch(error){console.error("Real-estate dashboard data failed",error);return NextResponse.json({error:"Could not load real-estate dashboard data."},{status:500,headers});}
}
