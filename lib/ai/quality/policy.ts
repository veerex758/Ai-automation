import type { AITask } from "../types";
import type { AIQualityMetrics,AIQualityThresholds } from "./types";
export const AI_QUALITY_BENCHMARK_VERSION="rexnora-quality-v1";
export const AI_QUALITY_THRESHOLDS:Record<AITask,AIQualityThresholds>={
 workflow_generation:{minimumSamples:20,minimumRecoverySamples:3,minimumTaskAccuracy:.9,minimumSchemaValidRate:.98,minimumWorkflowGraphCorrectness:.95,maximumP95LatencyMs:20000,maximumCostPerSuccessfulOperationUsd:.05,minimumRecoveryRate:.75},
 workflow_schema_repair:{minimumSamples:20,minimumRecoverySamples:3,minimumTaskAccuracy:.9,minimumSchemaValidRate:.98,minimumWorkflowGraphCorrectness:.95,maximumP95LatencyMs:20000,maximumCostPerSuccessfulOperationUsd:.05,minimumRecoveryRate:.75},
 workflow_debugging:{minimumSamples:20,minimumRecoverySamples:3,minimumTaskAccuracy:.9,maximumP95LatencyMs:20000,maximumCostPerSuccessfulOperationUsd:.05,minimumRecoveryRate:.75},
 lead_qualification:{minimumSamples:20,minimumRecoverySamples:3,minimumTaskAccuracy:.95,minimumSchemaValidRate:.99,maximumP95LatencyMs:10000,maximumCostPerSuccessfulOperationUsd:.02,minimumRecoveryRate:.75},
 email_drafting:{minimumSamples:20,minimumRecoverySamples:3,minimumTaskAccuracy:.9,maximumP95LatencyMs:12000,maximumCostPerSuccessfulOperationUsd:.02,minimumRecoveryRate:.75},
 data_extraction:{minimumSamples:20,minimumRecoverySamples:3,minimumTaskAccuracy:.97,minimumSchemaValidRate:.995,maximumP95LatencyMs:10000,maximumCostPerSuccessfulOperationUsd:.02,minimumRecoveryRate:.75},
 summarization:{minimumSamples:20,minimumRecoverySamples:3,minimumTaskAccuracy:.9,maximumP95LatencyMs:8000,maximumCostPerSuccessfulOperationUsd:.01,minimumRecoveryRate:.75},
 agent_tool_calling:{minimumSamples:20,minimumRecoverySamples:3,minimumTaskAccuracy:.95,minimumSchemaValidRate:.99,minimumToolCallAccuracy:.98,maximumP95LatencyMs:12000,maximumCostPerSuccessfulOperationUsd:.03,minimumRecoveryRate:.75}
};
export function assessAIModelQualification(task:AITask,m:AIQualityMetrics,n:number,recoveryN:number,t=AI_QUALITY_THRESHOLDS[task]){
 const r:string[]=[];
 if(!Number.isSafeInteger(n)||n<t.minimumSamples)r.push("insufficient_samples");
 if(!Number.isSafeInteger(recoveryN)||recoveryN<t.minimumRecoverySamples)r.push("insufficient_recovery_samples");
 if(!Number.isFinite(m.taskAccuracy)||m.taskAccuracy<t.minimumTaskAccuracy)r.push("task_accuracy_below_threshold");
 if(t.minimumSchemaValidRate!==undefined&&(m.schemaValidRate===null||m.schemaValidRate<t.minimumSchemaValidRate))r.push("schema_validity_below_threshold");
 if(t.minimumWorkflowGraphCorrectness!==undefined&&(m.workflowGraphCorrectness===null||m.workflowGraphCorrectness<t.minimumWorkflowGraphCorrectness))r.push("graph_correctness_below_threshold");
 if(t.minimumToolCallAccuracy!==undefined&&(m.toolCallAccuracy===null||m.toolCallAccuracy<t.minimumToolCallAccuracy))r.push("tool_call_accuracy_below_threshold");
 if(!Number.isFinite(m.p95LatencyMs)||m.p95LatencyMs>t.maximumP95LatencyMs)r.push("latency_above_threshold");
 if(m.costPerSuccessfulOperationUsd===null||!Number.isFinite(m.costPerSuccessfulOperationUsd)||m.costPerSuccessfulOperationUsd>t.maximumCostPerSuccessfulOperationUsd)r.push("cost_above_threshold");
 if(!Number.isFinite(m.recoveryRate)||m.recoveryRate<t.minimumRecoveryRate)r.push("recovery_rate_below_threshold");
 return {eligible:r.length===0,reasons:r};
}
