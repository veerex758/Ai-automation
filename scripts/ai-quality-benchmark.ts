import { createHash } from "node:crypto";
import type { AITask } from "../lib/ai/types";
import { AI_QUALITY_BENCHMARK_VERSION,AI_QUALITY_THRESHOLDS,assessAIModelQualification } from "../lib/ai/quality/policy";
import type { AIQualityMetrics } from "../lib/ai/quality/types";
export type BenchmarkObservation={schemaValid:boolean|null;taskCorrect:boolean;workflowGraphCorrectness?:boolean;toolCallAccuracy?:boolean;latencyMs:number;costUsd:number|null;recovered:boolean};
export function summarizeBenchmark(observations:BenchmarkObservation[]):AIQualityMetrics{
 const n=observations.length,rate=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
 const sorted=observations.map(x=>x.latencyMs).sort((a,b)=>a-b);
 const p95=sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]:Infinity;
 const successful=observations.filter(x=>x.taskCorrect);
 const costs=successful.map(x=>x.costUsd).filter((x):x is number=>x!==null&&Number.isFinite(x));
 const mean=(xs:number[])=>xs.length?rate(xs):null;
 const schema=observations.filter(x=>x.schemaValid!==null);
 const graph=observations.filter(x=>x.workflowGraphCorrectness!==undefined);
 const tool=observations.filter(x=>x.toolCallAccuracy!==undefined);
 return {schemaValidRate:mean(schema.map(x=>Number(x.schemaValid))),workflowGraphCorrectness:mean(graph.map(x=>Number(x.workflowGraphCorrectness))),toolCallAccuracy:mean(tool.map(x=>Number(x.toolCallAccuracy))),taskAccuracy:rate(observations.map(x=>Number(x.taskCorrect))),p95LatencyMs:p95,costPerSuccessfulOperationUsd:costs.length?rate(costs):null,recoveryRate:rate(observations.map(x=>Number(x.recovered))),recoverySampleCount:observations.filter(x=>x.recovered).length,successfulOperations:successful.length};
}
export function qualifyBenchmark(task:AITask,observations:BenchmarkObservation[]){
 const metrics=summarizeBenchmark(observations),thresholds=AI_QUALITY_THRESHOLDS[task];
 return {metrics,thresholds,...assessAIModelQualification(task,metrics,observations.length,metrics.recoverySampleCount,thresholds),datasetSha256:createHash("sha256").update(JSON.stringify(observations)).digest("hex"),benchmarkVersion:AI_QUALITY_BENCHMARK_VERSION};
}
