"use client";
import { useEffect,useState } from "react";
import "./billing.css";
import BillingCheckout from "./billing-checkout";
type BillingData={subscription:{plan_key:string,status:string,billing_provider?:string|null,current_period_end?:string|null};entitlements:{plan:string,status:string,usage:Record<string,number>,limits:Record<string,number|null>,billing:{checkout_enabled:boolean}};payments?:Array<{id:string;plan_slug:string;amount_minor:number;currency:string;status:string;created_at:string;paid_at:string|null}>;checkout_plan:{slug:string;amount_minor:number;currency:string}|null;plans:Array<{key:string,name:string,limits:Record<string,number|null>}>};
const labels:Record<string,string>={workflow_created:"Active workflows",workflow_execution:"Workflow executions",ai_credit:"AI credits"};
export default function BillingPage(){
 const [data,setData]=useState<BillingData|null>(null);const [error,setError]=useState("");const [loading,setLoading]=useState(true);
 useEffect(()=>{fetch("/api/billing",{cache:"no-store"}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error||"Billing data unavailable");setData(j)}).catch(e=>setError(e instanceof Error?e.message:"Billing unavailable")).finally(()=>setLoading(false))},[]);
 return <main className="billing-shell"><header><span className="billing-eyebrow">AIVANTA / WORKSPACE</span><h1>Plan &amp; usage</h1><p>Track your workspace usage, compare plans, and upgrade securely when billing is configured.</p></header¶»§q«^