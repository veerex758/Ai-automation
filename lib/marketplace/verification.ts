import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {validateDefinition}=require("../workflows/validate-definition.cjs") as {validateDefinition:(value:unknown)=>{definition?:unknown;error?:string}};
export type MarketplaceVerificationCheck={id:string;label:string;passed:boolean;detail:string};
export type MarketplaceVerificationResult={passed:boolean;checks:MarketplaceVerificationCheck[];artifactSha256:string};
const secretPatterns=[
 /(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*["'][^"']{8,}["']/i,
 /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
 /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
 /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
];
export function verifyMarketplaceArtifact(input:unknown):MarketplaceVerificationResult{
 const serialized=JSON.stringify(input??null),artifactSha256=createHash("sha256").update(serialized).digest("hex");
 const checks:MarketplaceVerificationCheck[]=[];
 const record=input&&typeof input==="object"&&!Array.isArray(input)?input as Record<string,unknown>:null;
 checks.push({id:"manifest_shape",label:"Product artifact is a JSON object",passed:!!record,detail:record?"Object manifest found":"Artifact must be an object"});
 const definition=record?.definition,validation=validateDefinition(definition);
 checks.push({id:"workflow_schema",label:"Workflow schema and registered operations",passed:!!validation.definition,detail:validation.definition?"Workflow definition passed validation":validation.error??"Invalid workflow"});
 const secretHit=secretPatterns.some(pattern=>pattern.test(serialized));
 checks.push({id:"secret_scan",label:"No embedded credentials or secret patterns",passed:!secretHit,detail:secretHit?"Potential secret detected; remove credentials before submission":"No configured secret patterns detected"});
 const candidate=definition&&typeof definition==="object"&&!Array.isArray(definition)?definition as {nodes?:unknown}:null;
 const nodes=Array.isArray(candidate?.nodes)?candidate.nodes:[];
 const external=nodes.some(node=>{if(!node||typeof node!=="object"||Array.isArray(node))return false;const n=node as Record<string,unknown>;const settings=n.settings&&typeof n.settings==="object"&&!Array.isArray(n.settings)?n.settings as Record<string,unknown>:{};return n.type==="action"&&settings.provider==="webhook"});
 checks.push({id:"external_action_disclosure",label:"External effects are declared",passed:!external||Array.isArray(record?.permissions),detail:external?"External webhook action detected; permissions must be declared":"No webhook action detected"});
 return {passed:checks.every(check=>check.passed),checks,artifactSha256};
}
