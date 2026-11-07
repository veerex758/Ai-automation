import { createHash } from "node:crypto";
import validateDefinition from "@/lib/workflows/validate-definition.cjs";

export type MarketplaceVerificationCheck={id:string;label:string;passed:boolean;detail:string};
export type MarketplaceVerificationResult={passed:boolean;checks:MarketplaceVerificationCheck[];artifactSha256:string};

const secretPatterns=[
 /(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*["'][^"']{8,}["']/i,
 /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
 /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
 /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
];

export function verifyMarketplaceArtifact(input:unknown):MarketplaceVerificationResult{
 const serialized=JSON.stringify(input??null);
 const artifactSha256=createHash("sha256").update(serialized).digest("hex");
 const checks:MarketplaceVerificationCheck[]=[];
 const record=input&&typeof input==="object"&&!Array.isArray(input)?input as Record<string,unknown>:null;
 checks.push({id:"manifest_shape",label:"Product artifact is a JSON object",passed:!!record,detail:record?"Object manifest found":"Artifact must be an object"});
 const definition=record?.definition;
 const validation=validateDefinition(definition);
 checks.push({id:"workflow_schema",label:"Workflow schema and registered operations",passed:!!validation.definition,detail:validation.definition?"Workflow definition passed validation":validation.error??"Invalid workflow"});
 const secretHit=secretPatterns.some(pattern=>pattern.test(serialized));
 checks.push({id:"secret_scan",label:"No embedded credentials or secret patterns",passed:!secretHit,detail:secretHit?"Potential secret detected; remove credentials before submission":"No configured secret patterns detected"});
 const nodes=record&&Array.isArray((record.definition as any)?.nodes)?(record.definition as any).nodes:[];
 const external=nodes.some((node:any)=>node?.type==="action"&&node?.settings?.provider==="webhook");
 checks.push({id:"external_action_disclosure",label:"External effects are declared",passed:!external||Array.isArray(record?.permissions),detail:external?"External webhook action detected; permissions must be declared":"No webhook action detected"});
 return {passed:checks.every(check=>check.passed),checks,artifactSha256};
}
