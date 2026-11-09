"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import "./agents.css";
type Agent={id:string;name:string;description:string;instructions:string;model_provider:string;model_name:string;tool_ids:string[];status:string;updated_at:string};
type Activity={id:string;agent_id:string;event_type:string;details:Record<string,unknown>;created_at:string};
const blank={name:"",description:"",instructions:"",model_provider:"gemini",model_name:"gemini-2.5-flash",tool_ids:[] as string[],status:"draft"};
export default function AgentsPage(){
const [agents,setAgents]=useState<Agent[]>([]),[activity,setActivity]=useState<Activity[]>([]),[selected,setSelected]=useState<Agent|null>(null),[form,setForm]=useState(blank),[creating,setCreating]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[runInput,setRunInput]=useState(""),[runOutput,setRunOutput]=useState(""),[search,setSearch]=useState(""),[statusFilter,setStatusFilter]=useState("all"),[runs,setRuns]=useState<Array<{id:string;status:string;input:string;output:string|null;error_code:string|null;created_at:string}>>([]);
async function load(){setLoading(true);try{const r=await fetch("/api/agents",{cache:"no-store"}),d=await r.json();if(!r.ok)throw Error(d.error);setAgents(d.agents??[]);setActivity(d.activity??[]);}catch(e){setError(e instanceof Error?e.message:"Unable to load agents.");}finally{setLoading(false)¶»§q«^