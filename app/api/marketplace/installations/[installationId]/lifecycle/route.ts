import {NextResponse,type NextRequest} from "next/server";import {createClient as createAdmin} from "@supabase/supabase-js";import {createClient} from "@/lib/supabase/server";
const h={"Cache-Control":"private, no-store"};type C={params:Promise<{installationId:string}>};const uuid=/^[0-9a-f-]{36}$/i;
function admin(){const u=process.env.NEXT_PUBLIC_SUPABASE_URL??process.env.NEXT_PUBLIC_CODED_SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.CODED_SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw Error("Installation lifecycle service unavailable");return createAdmin(u,k,{auth:{autoRefreshToken:false,persistSession:false}})}
function hasSecret(value:unknown):boolean{if(Array.isArray(value))return value.some(hasSecret);if(value&&typeof value==="object")return Object.entries(value).some(([k,v])=>/(secret|token|password|apikey|credential|private.?key)/i.test(k)||hasSecret(v));return false}
export async function POST(request:NextRequest,ctx:C){const sb=await createClient();const {data:{user},error:authError}=await sb.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:h});const {installationId}=await ctx.params;if(!uuid.test(installationId))return NextResponse.json({error:"Invalid installation id."},{status:400,headers:h});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>8000)return NextResponse.json({error:"Request too large."},{status:413,headers:h});let b:Record<string,unknown>;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers:h})};const action=String(b.action??"");if(!["configure","dry_run","activate","pause","uninstall","update","rollback"].includes(action))return NextResponse.json({error:"Choose configure, dry_run, activate, pause, uninstall, update or rollback."},{status:400,headers:h});
 const a=admin();const {data:i,error}=await a.from("marketplace_installations").select("id,workspace_id,product_id,product_version_id,workflow_id,status,configuration,installed_by").eq("id",installationId).eq("installed_by",user.id).maybeSingle();if(error)return NextResponse.json({error:"Could not load installation."},{status:500,headers:h});if(!i)return NextResponse.json({error:"Installation not found or not owned by this account."},{status:404,headers:h});
 if(action==="update"||action==="rollback"){
  const targetVersionId=typeof b.targetVersionId==="string"?b.targetVersionId:"";
  if(!uuid.test(targetVersionId))return NextResponse.json({error:"A valid targetVersionId is required."},{status:400,headers:h});
  const {data:product}=await a.from("marketplace_products").select("id,status,current_version_id").eq("id",i.product_id).maybeSingle();
  if(!product||product.status!=="published")return NextResponse.json({error:"This product is not available for version changes."},{status:409,headers:h});
  if(action==="update"&&targetVersionId!==product.current_version_id)return NextResponse.json({error:"Updates must target the latest catalog version."},{status:409,headers:h});
  const {data:version}=await a.from("marketplace_product_versions").select("id,artifact_path,artifact_sha256,verification_status,manifest,created_by").eq("id",targetVersionId).eq("product_id",i.product_id).maybeSingle();
  if(!version||version.verification_status!=="approved")return NextResponse.json({error:"The target version is not approved."},{status:409,headers:h});
  const parts=typeof version.artifact_path==="string"?version.artifact_path.split("/") : [];
  if(parts.length!==3||parts[0]!==version.created_by||parts[1]!==i.product_id||parts.some((part:string)=>!part||part==="."||part===".."||part.includes("\\")))return NextResponse.json({error:"The target artifact path is invalid."},{status:409,headers:h});
  const {data:file,error:fileError}=await a.storage.from("marketplace-artifacts").download(version.artifact_path);
  if(fileError||!file)return NextResponse.json({error:"The target artifact is unavailable."},{status:409,headers:h});
  if(file.size>524288)return NextResponse.json({error:"The target artifact exceeds the 512 KiB limit."},{status:413,headers:h});
  const integrity=verifyMarketplaceStoredArtifact(await file.text(),version.manifest,version.artifact_sha256);
  if(!integrity.integrityPassed||!integrity.verification.passed)return NextResponse.json({error:"The target artifact failed integrity or security checks."},{status:409,headers:h});
  const {data:transition,error:transitionError}=await a.rpc("marketplace_transition_installation_version",{p_installation_id:i.id,p_actor_id:user.id,p_action:action,p_target_version_id:targetVersionId,p_artifact_sha256:version.artifact_sha256});
  if(transitionError){const m=transitionError.message??"";return NextResponse.json({error:m.includes("pause_installation_before_version_transition")?"Pause the installation before updating or rolling back.":m.includes("rollback_target_not_in_installation_history")?"That version is not in this installation history.":"The installation version transition was rejected."},{status:409,headers:h});}
  return NextResponse.json({installation:transition,message:"A fresh inactive draft was created. Recheck connections, run a successful dry-run, then activate."},{headers:h});
 }
 if(action==="configure"){
  const config=b.configuration;
  if(!config||typeof config!=="object"||Array.isArray(config)||hasSecret(config))return NextResponse.json({error:"Configuration must contain non-secret connection mappings and options only."},{status:400,headers:h});
  const keys=Object.keys(config as Record<string,unknown>);
  if(keys.some(k=>!["connections","options"].includes(k)))return NextResponse.json({error:"Only connections and options are supported."},{status:400,headers:h});
  const connections=(config as Record<string,unknown>).connections;
  if(connections!==undefined){
   if(!connections||typeof connections!=="object"||Array.isArray(connections))return NextResponse.json({error:"Connection mappings must be an object."},{status:400,headers:h});
   for(const [provider,id] of Object.entries(connections as Record<string,unknown>)){
    if(!/^[a-z][a-z0-9_]{0,63}$/.test(provider)||typeof id!=="string"||!uuid.test(id))return NextResponse.json({error:"Each connection mapping needs a provider and valid connection ID."},{status:400,headers:h});
    if(provider==="gmail"||provider==="sheets"){
     const {data:connection}=await a.from("google_connections").select("id,product,status").eq("id",id).eq("workspace_id",i.workspace_id).maybeSingle();
     if(!connection||connection.product!==provider||connection.status!=="connected")return NextResponse.json({error:"A mapped Google connection is not connected to this workspace."},{status:409,headers:h});
    }else{
     const {data:connection}=await a.from("workspace_integrations").select("id,provider,status,last_test_status").eq("id",id).eq("workspace_id",i.workspace_id).maybeSingle();
     if(!connection||connection.provider!==provider||connection.status!=="connected"||connection.last_test_status!=="passed")return NextResponse.json({error:"A mapped integration is not verified and connected to this workspace."},{status:409,headers:h});
    }
   }
  }
  const encoded=JSON.stringify(config);if(encoded.length>5000)return NextResponse.json({error:"Configuration exceeds 5,000 characters."},{status:413,headers:h});
  const {data,error:rpcError}=await a.rpc("marketplace_installation_lifecycle",{p_installation_id:i.id,p_actor_id:user.id,p_action:"configure",p_configuration:config});
  if(rpcError)return NextResponse.json({error:"Could not save installation configuration."},{status:409,headers:h});
  return NextResponse.json({installation:data},{headers:h})
 }
 if(action==="dry_run"){if(!i.workflow_id)return NextResponse.json({error:"Installed draft workflow is missing."},{status:409,headers:h});const url=new URL("/api/workflows/"+i.workflow_id+"/registry-run",request.url);const response=await fetch(url,{method:"POST",headers:{cookie:request.headers.get("cookie")??"", "Content-Type":"application/json"},body:JSON.stringify({dryRun:true}),cache:"no-store"});const result=await response.json();if(!response.ok||result?.run?.status!=="succeeded")return NextResponse.json({error:"Dry-run did not succeed. Installation remains inactive.",dryRun:result},{status:422,headers:h});const {data,error:readyError}=await a.rpc("marketplace_installation_lifecycle",{p_installation_id:i.id,p_actor_id:user.id,p_action:"mark_ready",p_configuration:null});if(readyError)return NextResponse.json({error:"Dry-run succeeded but installation readiness could not be recorded."},{status:409,headers:h});return NextResponse.json({installation:data,dryRun:{status:result.run.status,run_id:result.run.id,sideEffectsPerformed:false}},{headers:h})}
 const {data,error:transitionError}=await a.rpc("marketplace_installation_lifecycle",{p_installation_id:i.id,p_actor_id:user.id,p_action:action,p_configuration:null});if(transitionError){const m=transitionError.message??"";return NextResponse.json({error:m.includes("successful_dry_run_required")?"A successful dry-run is required before activation.":m.includes("product_version_no_longer_current")?"This version is no longer current and verified.":m.includes("installation_not_active")?"Only active installations can be paused.":"Installation transition was rejected."},{status:409,headers:h})}return NextResponse.json({installation:data},{headers:h})}
