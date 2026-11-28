import type { AITask } from "../types";
import type { AIModelQualityStore,AIModelQualification } from "./types";
export class SupabaseAIModelQualityStore implements AIModelQualityStore {
 private async client(){const {createAdminClient}=await import("../../supabase/admin");return createAdminClient();}
 async listEligibleModels(task:AITask,version:string){
  const c=await this.client();const {data,error}=await c.rpc("list_eligible_ai_models",{p_task:task,p_benchmark_version:version});
  if(error)throw new Error("AI_MODEL_QUALITY_STORE_UNAVAILABLE");
  return (Array.isArray(data)?data:[]).filter((x):x is AIModelQualification=>!!x&&typeof x==="object"&&(x as AIModelQualification).eligible===true);
 }
 async recordEvaluation(value:Omit<AIModelQualification,"eligible"|"evaluatedAt">){
  const c=await this.client();const {data,error}=await c.rpc("record_ai_model_evaluation",{p_evaluation:value});
  if(error)throw new Error("AI_MODEL_QUALITY_WRITE_UNAVAILABLE");
  const row=data&&typeof data==="object"?data as {eligible?:boolean;reasons?:string[]}:{};
  return {eligible:row.eligible===true,reasons:Array.isArray(row.reasons)?row.reasons:[]};
 }
}
