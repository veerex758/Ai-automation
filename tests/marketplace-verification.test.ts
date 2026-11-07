import test from "node:test";
import assert from "node:assert/strict";
import { verifyMarketplaceArtifact } from "../lib/marketplace/verification";

const valid={definition:{version:1,nodes:[{id:"start",type:"trigger",title:"Manual start",description:"",settings:{event:"manual"}}]}};
test("marketplace verification accepts valid workflow manifest without secret",()=>{
 const result=verifyMarketplaceArtifact(valid);assert.equal(result.passed,true);assert.equal(result.checks.every(x=>x.passed),true);assert.match(result.artifactSha256,/^[a-f0-9]{64}$/);
});
test("marketplace verification rejects malformed workflow definitions",()=>{
 const result=verifyMarketplaceArtifact({definition:{version:9,nodes:[]}});assert.equal(result.passed,false);assert.equal(result.checks.find(x=>x.id==="workflow_schema")?.passed,false);
});
test("marketplace verification flags embedded credential patterns",()=>{
 const result=verifyMarketplaceArtifact({...valid,notes:"api_key: 'super-secret-value-123'"});assert.equal(result.passed,false);assert.equal(result.checks.find(x=>x.id==="secret_scan")?.passed,false);
});
test("marketplace verification requires permission declaration for external webhook actions",()=>{
 const result=verifyMarketplaceArtifact({definition:{version:1,nodes:[{id:"start",type:"trigger",title:"Manual start",description:"",settings:{event:"manual"}},{id:"send",type:"action",title:"Send webhook",description:"",settings:{provider:"webhook",operation:"http_request",url:"https://example.com"}}]}});assert.equal(result.checks.find(x=>x.id==="external_action_disclosure")?.passed,false);
});
