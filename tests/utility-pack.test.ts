import test from "node:test";
import assert from "node:assert/strict";
import { findOperation } from "../nodes/registry";
const context={credentials:{},logger:{info(){},error(){}},http:{async request(){throw Error("no network")}},previousOutputs:{}};
test("utility pack exposes 20 registered, schema-backed operations",()=>{
 const ids=["deduplicate","sort","split_batches","crypto_hash","template","csv_parse","csv_stringify","markdown_html","text_transform","regex","array_ops","object_ops","math","uuid","base64","date_add","date_format","error_trigger","rate_limiter","json_encode"];
 assert.equal(ids.length,20);
 for(const id of ids)assert.ok(findOperation(id,id==="deduplicate"?"unique":id==="sort"?"sort_items":id==="split_batches"?"split":id==="crypto_hash"?"hash":id==="template"?"render":id==="csv_parse"?"parse":id==="csv_stringify"?"stringify":id==="markdown_html"?"convert":id==="text_transform"?"transform":id==="regex"?"match":id==="array_ops"||id==="object_ops"?"operate":id==="math"?"calculate":id==="uuid"?"generate":id==="base64"?"convert":id==="date_add"?"add":id==="date_format"?"format":id==="error_trigger"?"capture":id==="rate_limiter"?"check":"encode","action");
});
test("deduplicate and sort utilities operate deterministically",async()=>{
 const d=await findOperation("deduplicate","unique","action")!.run(context,{items:[1,1,2,3,2]});
 assert.deepEqual(d,{items:[1,2,3],count:3});
 const s=await findOperation("sort","sort_items","action")!.run(context,{items:[{n:3},{n:1},{n:2}],path:["n"]});
 assert.deepEqual(s,{items:[{n:1},{n:2},{n:3}],count:3});
});
test("hash, template and JSON encode utilities return bounded results",async()=>{
 const h=await findOperation("crypto_hash","hash","action")!.run(context,{value:"abc"});
 assert.equal((h as any).digest,"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
 const t=await findOperation("template","render","action")!.run(context,{template:"Hi {{user.name}}",data:{user:{name:"Ada"}}});
 assert.deepEqual(t,{text:"Hi Ada"});
 const j=await findOperation("json_encode","encode","action")!.run(context,{value:{ok:true}});
 assert.deepEqual(j,{json:'{"ok":true}'});
});
test("CSV parse and stringify round trip simple quoted fields",async()=>{
 const p=await findOperation("csv_parse","parse","action")!.run(context,{csv:'name,city\nAda,"Lagos, NG"'});
 assert.equal((p as any).rows[0].city,"Lagos, NG");
 const s=await findOperation("csv_stringify","stringify","action")!.run(context,{rows:[{name:"Ada",city:"Lagos, NG"}]});
 assert.match((s as any).csv,/Lagos, NG/);
});
test("Math rejects division by zero and Base64 rejects malformed input",async()=>{
 await assert.rejects(()=>findOperation("math","calculate","action")!.run(context,{a:1,b:0,operation:"div"}),/MATH_INVALID_RESULT/);
 await assert.rejects(()=>findOperation("base64","convert","action")!.run(context,{value:"!!!",operation:"decode"}),/BASE64_INVALID/);
});
