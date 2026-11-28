import type { AITask } from "../types";
import type { AIRoute } from "../router";
import type { AIModelQualityStore,AIModelQualification } from "./types";
import {AI_QUALITY_BENCHMARK_VERSION,AI_QUALITY_THRESHOLDS,assessAIModelQualification} from "./policy";
function qualified(q:AIModelQualification[],provider:string,model:string,task:AITask){
 const x=q.find(v=>v.provider===provider&&v.model===model&&v.task===task&&v.eligible);
 return x&&assessAIModelQualification(task,x.metrics,x.sampleCount,x.recoverySampleCount,AI_QUALITY_THRESHOLDS[task]).eligible?x:null;
}
export async function applyQualityAwareRouting(routes:AIRoute[],task:AITask,store:AIModelQualityStore,requirePrimary=false):Promise<AIRoute[]>{
 if(!routes.length)return [];
 let q:AIModelQualification[];
 try{q=await store.listEligibleModels(task,AI_QUALITY_BENCHMARK_VERSION);}catch{return requirePrimary?[]:[{...routes[0],fallbackModels:[]}];}
 const primary=routes[0],p=qualified(q,primary.provider.id,primary.primaryModel,task);
 if(requirePrimary&&!p)return [];
 const primaryFallbacks=primary.fallbackModels.filter(m=>qualified(q,primary.provider.id,m,task));
 const output:AIRoute[]=[{...primary,fallbackModels:primaryFallbacks}];
 const alternates=routes.slice(1).flatMap(route=>{
  const models=[route.primaryModel,...route.fallbackModels].map(model=>({model,q:qualified(q,route.provider.id,model,task)})).filter(x=>x.q);
  models.sort((a,b)=>b.q!.metrics.taskAccuracy-a.q!.metrics.taskAccuracy||a.q!.metrics.p95LatencyMs-b.q!.metrics.p95LatencyMs);
  return models.length?[{...route,primaryModel:models[0].model,fallbackModels:models.slice(1).map(x=>x.model)}]:[];
 });
 return [...output,...alternates];
}
