import {NextResponse} from "next/server";
import {createClient as adminClient} from "@supabase/supabase-js";
import {createClient} from "@/lib/supabase/server";
const headers={"Cache-Control":"private, no-store"};
export async function GET(){
 try{
  const session=await createClient();const {data:{user},error}=await session.auth.getUser();
  if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const reviewers=(process.env.AIVANTA_MARKETPLACE_REVIEWER_IDS??"").split(",").map(x=>x.trim()).filter(Boolean);
  if(!reviewers.includes(user.id))return NextResponse.json({error:"Marketplace finance/reviewer access required."},{status:403,headers});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error("Settlement service unavailable");
  const admin=adminClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const [reconciliation,eligibility]=await Promise.all([
   admin.rpc("marketplace_financial_reconciliation"),
   admin.rpc("marketplace_creator_payout_eligibility",{p_minimum_minor:5000})
  ]);
  if(reconciliation.error)throw reconciliation.error;if(eligibility.error)throw eligibility.error;
  return NextResponse.json({reconciliation:{clear:(reconciliation.data??[]).length===0,discrepancies:reconciliation.data??[]},payoutEligibility:eligibility.data??[],minimumPayoutMinor:5000,transferEnabled:false},{headers});
 }catch(e){console.error("Marketplace settlement report failed",e);return NextResponse.json({error:"Settlement report unavailable."},{status:500,headers})}
}
