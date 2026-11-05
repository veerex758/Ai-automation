import test from "node:test";
import assert from "node:assert/strict";
import { findOperation } from "../nodes/registry";
const context={credentials:{},logger:{info(){},error(){}},http:{async request(){throw Error("no network")}},previousOutputs:{}};
test("utility pack exposes 20 registered, schema-backed operations",()=>{
 const ids=["deduplicate","sort","split_batches","crypto_hash","template","csv_parse","csv_stringify","markdown_html","text_transform","regex","array_ops","object_ops","math","uuid","base64","date_add","date_format","error_trigger","rate_limiter","json_encode"];
 assert.equal(ids.length,20);
 for(const id of ids)assert.ok(findOperation(id,id==="deduplicate"?"unique":id==="sort"?"sort_items":id==="split_batches"?"split":id==="crypto_hash"?"hash":id==="template"?"render":id==="csv_parse"?"parse":id==="csv_stringify"?"stringify":id==="markdown_html"?"convert":id==="text_transform"?"transform":id==="regex"?"match":id==="array_ops"||id==="object_ops"?"operate":id==="math"?"calculate":id==="uuid"?"generate":id==="base64"?"convert":id==="date_add"?"add":id==="date_format"?"format":id==="error_trigger"?"capture":id==="rate_limiter"?"check":"encode",id==="error_trigger"?"trigger":"action"));
});
test("deduplicate and sort utilities operate deterministically",async()=>{
 const d=await findOperation("deduplicate","unique","action")!.run(context,{items:[1,1,2,3,2]});
 assert.deepEqual(d,{items:[1,2,3],count:3});
 const s=await findOperation("sort","sort_items","action")!.run(context,{items:[{n:3},{n:1},{n:2}],path:["n"]});
 assert.deepEqual(s,{items:[{n:1},{n:2},{n:3}],count:3});
});
test("hash, template and JSON encode utilities return bounded results",async()=>{
 const h=await findOperation("crypto_hash","hash","action")!.run(context,{value:"abc"});
 assert.equal((h as { digest: string }).digest,"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
 const t=await findOperation("template","render","action")!.run(context,{template:"Hi {{user.name}}",data:{user:{name:"Ada"}}});
 assert.deepEqual(t,{text:"Hi Ada"});
 const j=await findOperation("json_encode","encode","action")!.run(context,{value:{ok:true}});
 assert.deepEqual(j,{json:'{"ok":true}'});
});
test("CSV parse and stringify round trip simple quoted fields",async()=>{
 const p=await findOperation("csv_parse","parse","action")!.run(context,{csv:'name,city\nAda,"Lagos, NG"'});
 assert.equal((p as { rows: Array<Record<string, string>> }).rows[0].city,"Lagos, NG");
 const s=await findOperation("csv_stringify","stringify","action")!.run(context,{rows:[{name:"Ada",city:"Lagos, NG"}]});
 assert.match((s as { csv: string }).csv,/Lagos, NG/);
});
test("Math rejects division by zero and Base64 rejects malformed input",async()=>{
 await assert.rejects(()=>findOperation("math","calculate","action")!.run(context,{a:1,b:0,operation:"div"}),/MATH_INVALID_RESULT/);
 await assert.rejects(()=>findOperation("base64","convert","action")!.run(context,{value:"!!!",operation:"decode"}),/BASE64_INVALID/);
});


test("Split in Batches emits bounded batches and enforces batch count",async()=>{
 const op=findOperation("split_batches","split","action")!;
 const output=await op.run(context,{items:[1,2,3,4,5],batchSize:2});
 assert.deepEqual(output,{batches:[[1,2],[3,4],[5]],count:3,itemCount:5,batchSize:2});
 await assert.rejects(()=>op.run(context,{items:[1,2,3],batchSize:1,maxBatches:2}),/BATCH_COUNT_LIMIT_EXCEEDED/);
});

test("Rate Limiter fails closed without a shared atomic backend",async()=>{
 const op=findOperation("rate_limiter","check","action")!;
 await assert.rejects(()=>op.run(context,{key:"workspace:flow",limit:2,windowMs:1000}),/RATE_LIMIT_BACKEND_UNAVAILABLE/);
});

test("Rate Limiter delegates every decision to the shared atomic backend",async()=>{
 const op=findOperation("rate_limiter","check","action")!;
 const calls:Array<Record<string,unknown>>=[];
 const result=await op.run({...context,rateLimit:{async consume(args){calls.push(args);return {allowed:false,remaining:0,retryAfterMs:250}}}},{key:"workspace:flow",limit:2,windowMs:1000});
 assert.deepEqual(result,{allowed:false,remaining:0,retryAfterMs:250});
 assert.deepEqual(calls,[{key:"workspace:flow",limit:2,windowMs:1000}]);
});

test("Error Trigger is a real trigger operation and normalizes failure metadata",async()=>{
 const op=findOperation("error_trigger","capture","trigger")!;
 assert.ok(op);
 const output=await op.run(context,{code:"PROVIDER_TIMEOUT",message:"Provider timed out",workflowRunId:"00000000-0000-4000-8000-000000000001",stepId:"send"});
 assert.equal((output as any).error.code,"PROVIDER_TIMEOUT");
 assert.equal((output as any).error.stepId,"send");
 assert.match((output as any).error.eventId,/^[0-9a-f-]{36}$/);
 assert.ok(Date.parse((output as any).error.occurredAt)>0);
 await assert.rejects(()=>op.run(context,{code:"bad code",message:"invalid"}));
});

test("Regex rejects nested quantifiers and expensive pattern constructs",async()=>{
 const op=findOperation("regex","match","action")!;
 await assert.rejects(()=>op.run(context,{text:"aaaaaaaaaaaaaaaa!",pattern:"(a+)+$",flags:""}),/REGEX_UNSAFE/);
 await assert.rejects(()=>op.run(context,{text:"a",pattern:"(a)\\\\1",flags:""}),/REGEX_UNSAFE/);
 const output=await op.run(context,{text:"abc abc",pattern:"abc",flags:"g"});
 assert.deepEqual(output,{matched:true,matches:["abc","abc"]});
});

test("Text replace rejects empty search and preserves literal replacement",async()=>{
 const op=findOperation("text_transform","transform","action")!;
 await assert.rejects(()=>op.run(context,{text:"abc",operation:"replace",search:""}),/TEXT_SEARCH_REQUIRED/);
 assert.deepEqual(await op.run(context,{text:"a.b.a",operation:"replace",search:".",replacement:"-"}),{text:"a-b-a"});
});

test("Array and Object utilities enforce bounded safe transformations",async()=>{
 const array=findOperation("array_ops","operate","action")!;
 assert.deepEqual(await array.run(context,{items:[[1,2],[3]],operation:"flatten"}),{items:[1,2,3],count:3});
 const object=findOperation("object_ops","operate","action")!;
 await assert.rejects(()=>object.run(context,{data:{"__proto__":"bad",safe:1},operation:"pick",keys:["__proto__"]}),/OBJECT_UNSAFE_KEY/);
});

test("UUID utility emits cryptographically valid UUIDs",async()=>{
 const output=await findOperation("uuid","generate","action")!.run(context,{});
 assert.match((output as any).uuid,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("Date Add rejects overflow and Date Format rejects invalid timezones",async()=>{
 const add=findOperation("date_add","add","action")!;
 await assert.rejects(()=>add.run(context,{date:"2026-01-01T00:00:00.000Z",amount:1e20,unit:"d"}),/DATE_RANGE_INVALID/);
 const format=findOperation("date_format","format","action")!;
 await assert.rejects(()=>format.run(context,{date:"2026-01-01T00:00:00.000Z",timezone:"Mars/Olympus"}),/DATE_TIMEZONE_INVALID/);
});

test("Markdown converter escapes raw HTML before producing markup",async()=>{
 const op=findOperation("markdown_html","convert","action")!;
 assert.deepEqual(await op.run(context,{markdown:"<script>alert(1)</script>"}),{html:"<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"});
});
