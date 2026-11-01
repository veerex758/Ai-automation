"use client";
import { useCallback, useEffect, useState } from "react";

type Connection = { product: "gmail" | "sheets"; accountEmail: string; status: string; scopes: string[] };
export default function GoogleOAuthConnections() {
  const [connections,setConnections]=useState<Connection[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [configured,setConfigured]=useState(false);
  const refresh=useCallback(async()=>{
    setLoading(true); setError("");
    try {
      const response=await fetch("/api/integrations/google/status",{cache:"no-store"});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||"Could not load Google connections.");
      setConnections(data.connections||[]); setConfigured(Boolean(data.oauthConfigured));
    } catch(e) { setError(e instanceof Error?e.message:"Could not load Google connections."); }
    finally { setLoading(false); }
  },[]);
  useEffect(()=>{void refresh();const params=new URLSearchParams(window.location.search);const result=params.get("google");if(result){setNotice(result.replaceAll("_"," "));window.history.replaceState({}, "", window.location.pathname);}},[refresh]);
  const connection=(product:"gmail"|"sheets")=>connections.find(c=>c.product===product);
  return <section className="google-oauth-panel">
    <div className="google-oauth-heading"><div><span className="dash-eyebrow">GOOGLE WORKSPACE</span><h2>Connect your Google account</h2><p>Authorize Gmail and Sheets separately. Aivanta requests read-only access for these nodes.</p></div><span className="google-oauth-mark">G</span></div>
    {!configured&&<p className="google-oauth-warning">Google OAuth is not configured on this environment. Add the Google client ID, client secret and exact callback URL to the server environment.</p>}
    {notice&&<p className="google-oauth-notice" role="status">Google authorization: {notice}</p>}
    {error&&<p className="google-oauth-warning" role="alert">{error}</p>}
    <div className="google-oauth-grid">
      {(["gmail","sheets"] as const).map(product=>{const current=connection(product);const connected=current?.status==="connected";return <article className="google-oauth-card" key={product}>
        <div className="google-oauth-app-icon">{product==="gmail"?"M":"▦"}</div><div className="google-oauth-card-copy"><h3>{product==="gmail"?"Gmail":"Google Sheets"}</h3><p>{product==="gmail"?"Read and search messages in the connected mailbox.":"Read cell ranges from spreadsheets you can access."}</p>
        {loading?<span className="google-oauth-status">Checking connection…</span>:connected?<span className="google-oauth-connected">Connected · {current.accountEmail}</span>:<span className="google-oauth-status">Not connected</span>}</div>
        <a className="google-oauth-button" aria-disabled={!configured||loading} href={configured?"/api/integrations/google/connect?product="+product:undefined}>{connected?"Reconnect Google":"Connect Google"}</a>
      </article>})}
    </div>
    <p className="google-oauth-footnote">Tokens are encrypted at rest. Aivanta does not request Gmail sending or Google Sheets editing permissions.</p>
    <button className="google-oauth-refresh" type="button" onClick={()=>void refresh()}>Refresh connection status</button>
  </section>;
}
