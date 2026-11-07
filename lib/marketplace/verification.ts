import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {validateDefinition}=require("../workflows/validate-definition.cjs") as {validateDefinition:(value:unknown)=>{definition?:unknown;error?:string}};
const {getNodeRegistry}=require("../workflows/node-registry.cjs") as {getNodeRegistry:()=>{triggers:Array<{id:string;execution:string}>;actions:Array<{id:string;execution:string}>}};
export type MarketplaceVerificationCheck={id:string;label:string;passed:boolean;detail:string};
export type MarketplaceVerificationResult={passed:boolean;checks:MarketplaceVerificationCheck[];artifactSha256:string};
const secretPatterns=[
 /(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*["'][^"']{8,}["']/i,
 /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
 /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
 /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
];
function canonicalize(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonicalize);
 if(value&&typeof value==="object"){
  const sorted:Record<string,unknown>={};
  for(const key of Object.keys(value).sort())sorted[key]=canonicalize((value as Record<string,unknown>)[key]);
  return sorted;
 }
 return value;
}
function permissionId(value:unknown):string|null{
 if(typeof value==="string")return value.trim();
 if(value&&typeof value==="object"&&!Array.isArray(value)){
  const item=value as Record<string,unknown>;
  if(typeof item.provider==="string"&&typeof item.operation==="string")return `${item.provider}.${item.operation}`;
  if(typeof item.id==="string")return item.id.trim();
 }
 return null;
}
export function verifyMarketplaceArtifact(input:unknown):MarketplaceVerificationResult{
 const serialized=JSON.stringify(canonicalize(input??null))??"null";
 const artifactSha256=createHash("sha256").update(serialized).digest("hex");
 const checks:MarketplaceVerificationCheck[]=[];
 const record=input&&typeof input==="object"&&!Array.isArray(input)?input as Record<string,unknown>:null;
 checks.push({id:"manifest_shape",label:"Product artifact is a JSON object",passed:!!record,detail:record?"Object manifest found":"Artifact must be an object"});
 const definition=record?.definition,validation=validateDefinition(definition);
 checks.push({id:"workflow_schema",label:"Workflow schema and registered operations",passed:!!validation.definition,detail:validation.definition?"Workflow definition passed validation":validation.error??"Invalid workflow"});
 const secretHit=secretPatterns.some(pattern=>pattern.test(serialized));
 checks.push({id:"secret_scan",label:"No embedded credentials or secret patterns",passed:!secretHit,detail:secretHit?"Potential secret detected; remove credentials before submission":"No configured secret patterns detected"});
 const workflow=definition&&typeof definition==="object"&&!Array.isArray(definition)?definition as {nodes?:unknown}:null;
 const nodes=Array.isArray(workflow?.nodes)?workflow.nodes.filter((n):n is Record<string,unknown>=>!!n&&typeof n==="object"&&!Array.isArray(n)):[];
 const registry=getNodeRegistry();
 const known=new Set([...registry.triggers,...registry.actions].map(node=>node.id));
 const unknown:string[]=[];
 for(const node of nodes){
  const settings=node.settings&&typeof node.settings==="object"&&!Array.isArray(node.settings)?node.settings as Record<string,unknown>:{};
  const id=node.type==="trigger"&&typeof settings.event==="string"?`trigger.${settings.event}`:node.type==="action"&&typeof settings.provider==="string"&&typeof settings.operation==="string"?`${settings.provider}.${settings.operation}`:null;
  if(id&&!known.has(id))unknown.push(id);
 }
 checks.push({id:"registry_operations",label:"Every operation exists in the Aivanta node registry",passed:unknown.length===0,detail:unknown.length? `Unregistered operations: ${unknown.join(", ")}`:"All workflow operations resolve to registered nodes"});
 const declared=Array.isArray(record?.permissions)?record.permissions.map(permissionId).filter((x):x is string=>!!x):[];
 const required:string[]=[];
 for(const node of nodes){
  const settings=node.settings&&typeof node.settings==="object"&&!Array.isArray(node.settings)?node.settings as Record<string,unknown>:{};
  if(node.type==="trigger"&&settings.event==="webhook")required.push("trigger.webhook");
  if(node.type==="action"&&typeof settings.provider==="string"&&settings.provider!=="internal"&&typeof settings.operation==="string")required.push(`${settings.provider}.${settings.operation}`);
 }
 const missing=[...new Set(required)].filter(id=>!declared.includes(id));
 checks.push({id:"permission_declarations",label:"External operations have explicit permission declarations",passed:missing.length===0,detail:missing.length?`Declare these permissions: ${missing.join(", ")}`:"All external operations have matching permission declarations"});
 const capabilitySummary=nodes.map(node=>{
  const settings=node.settings&&typeof node.settings==="object"&&!Array.isArray(node.settings)?node.settings as Record<string,unknown>:{};
  const id=node.type==="trigger"&&typeof settings.event==="string"?`trigger.${settings.event}`:node.type==="action"&&typeof settings.provider==="string"&&typeof settings.operation==="string"?`${settings.provider}.${settings.operation}`:null;
  const found=[...registry.triggers,...registry.actions].find(item=>item.id===id);
  return found?`${id}: ${found.execution}`:id??"unknown";
 });
 checks.push({id:"execution_capabilities",label:"Execution capabilities are disclosed",passed:capabilitySummary.every(x=>!x.startsWith("unknown")),detail:capabilitySummary.length?capabilitySummary.join("; "):"No executable nodes found"});
 return {passed:checks.every(check=>check.passed),checks,artifactSha256};
}

export type MarketplaceStoredArtifactResult={integrityPassed:boolean;verification:MarketplaceVerificationResult;detail:string};
export function verifyMarketplaceStoredArtifact(content:string,storedManifest:unknown,expectedSha256:string):MarketplaceStoredArtifactResult{
 let parsed:unknown;
 try{parsed=JSON.parse(content);}catch{
  return {integrityPassed:false,verification:verifyMarketplaceArtifact(null),detail:"Stored artifact is not valid JSON"};
 }
 const fileVerification=verifyMarketplaceArtifact(parsed);
 const manifestVerification=verifyMarketplaceArtifact(storedManifest);
 const integrityPassed=/^[a-f0-9]{64}$/.test(expectedSha256)
  &&fileVerification.artifactSha256===expectedSha256
  &&manifestVerification.artifactSha256===expectedSha256;
 return {
  integrityPassed,
  verification:fileVerification,
  detail:integrityPassed
   ?"Uploaded artifact bytes, stored manifest, and recorded SHA-256 agree"
   :"Uploaded artifact bytes, stored manifest, and recorded SHA-256 do not agree"
 };
}
