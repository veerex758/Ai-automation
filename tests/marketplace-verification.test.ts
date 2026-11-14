import test from "node:test";
import assert from "node:assert/strict";
import {verifyMarketplaceArtifact,verifyMarketplaceStoredArtifact} from "../lib/marketplace/verification";
const valid={definition:{version:1,nodes:[{id:"start",type:"trigger",title:"Manual start",description:"",settings:{event:"manual"}}]}};
test("marketplace verification accepts a valid registry-backed workflow",()=>{
 const result=verifyMarketplaceArtifact(valid);assert.equal(result.passed,true);assert.equal(result.checks.every(x=>x.passed),true);assert.match(result.artifactSha256,/^[a-f0-9]{64}$/);
});
test("marketplace verification rejects malformed workflow definitions",()=>{
 const result=verifyMarketplaceArtifact({definition:{version:9,nodes:[]}});assert.equal(result.passed,false);assert.equal(result.checks.find(x=>x.id==="workflow_schema")?.passed,false);
});
test("marketplace verification flags embedded credential patterns",()=>{
 const result=verifyMarketplaceArtifact({...valid,notes:"api_key: 'super-secret-value-123'"});assert.equal(result.passed,false);assert.equal(result.checks.find(x=>x.id==="secret_scan")?.passed,false);
});
test("marketplace verification requires declared permissions for external operations",()=>{
 const artifact={permissions:[],definition:{version:1,nodes:[...valid.definition.nodes,{id:"send",type:"action",title:"Send webhook",description:"",settings:{provider:"webhook",operation:"http_request",url:"https://example.com"}}]}};
 const result=verifyMarketplaceArtifact(artifact);assert.equal(result.checks.find(x=>x.id==="permission_declarations")?.passed,false);
});
test("marketplace verification accepts exact declared external operation permissions",()=>{
 const artifact={permissions:["webhook.http_request"],definition:{version:1,nodes:[...valid.definition.nodes,{id:"send",type:"action",title:"Send webhook",description:"",settings:{provider:"webhook",operation:"http_request",url:"https://example.com"}}]}};
 const result=verifyMarketplaceArtifact(artifact);assert.equal(result.checks.find(x=>x.id==="permission_declarations")?.passed,true);
});
test("marketplace artifact hash is canonical across JSON object key order",()=>{
 const left=verifyMarketplaceArtifact({definition:{version:1,nodes:[{id:"start",type:"trigger",title:"Manual start",description:"",settings:{event:"manual"}}]}});
 const right=verifyMarketplaceArtifact({definition:{nodes:[{settings:{event:"manual"},description:"",title:"Manual start",type:"trigger",id:"start"}],version:1}});
 assert.equal(left.artifactSha256,right.artifactSha256);
});

test("marketplace review integrity binds uploaded bytes, stored manifest, and recorded hash",()=>{
 const content=JSON.stringify(valid);
 const expected=verifyMarketplaceArtifact(valid).artifactSha256;
 const matching=verifyMarketplaceStoredArtifact(content,valid,expected);
 assert.equal(matching.integrityPassed,true);
 assert.equal(matching.verification.passed,true);
 const altered=verifyMarketplaceStoredArtifact(JSON.stringify({...valid,extra:"tampered"}),valid,expected);
 assert.equal(altered.integrityPassed,false);
 const mismatchedManifest=verifyMarketplaceStoredArtifact(content,{...valid,extra:"different"},expected);
 assert.equal(mismatchedManifest.integrityPassed,false);
});

test("marketplace verification rejects dynamic code execution",()=>{
 const result=verifyMarketplaceArtifact({...valid,notes:"eval(userInput)"});
 assert.equal(result.checks.find(x=>x.id==="dynamic_code_execution")?.passed,false);
});
test("marketplace verification flags credential-to-network exfiltration patterns",()=>{
 const result=verifyMarketplaceArtifact({...valid,notes:"process.env.API_KEY; fetch("});
 assert.equal(result.checks.find(x=>x.id==="credential_exfiltration")?.passed,false);
});
test("marketplace verification rejects encoded executable payload patterns",()=>{
 const result=verifyMarketplaceArtifact({...valid,notes:"atob(payload); eval("});
 assert.equal(result.checks.find(x=>x.id==="obfuscated_payload")?.passed,false);
});
test("marketplace verification flags destructive infrastructure commands",()=>{
 const result=verifyMarketplaceArtifact({...valid,notes:"DROP DATABASE production"});
 assert.equal(result.checks.find(x=>x.id==="destructive_operations")?.passed,false);
});
