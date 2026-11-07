import test from "node:test";
import assert from "node:assert/strict";
import {verifyMarketplaceArtifact} from "../lib/marketplace/verification";
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
