import type { AITask } from "../types";
export type AIQualityCase={id:string;task:AITask;prompt:string;expected:Record<string,unknown>;grade:(output:unknown)=>{schemaValid:boolean|null;taskCorrect:boolean;workflowGraphCorrectness?:boolean;toolCallAccuracy?:boolean}};
const leads=Array.from({length:20},(_,i)=>{
 const budget=180000+i*23500,timeline=30+(i*17)%150,area=["Lekki","Yaba","Ikeja","Ajah","Ikoyi"][i%5],qualified=budget>=250000&&timeline<=90;
 const expected={isQualified:qualified,budgetUsd:budget,preferredArea:area,timelineDays:timeline};
 return {id:"lead-"+(i+1),task:"lead_qualification" as const,prompt:"Classify lead using budget >= 250000 and timeline <= 90 days. Return JSON with isQualified,budgetUsd,preferredArea,timelineDays. Facts: budget "+budget+", area "+area+", timeline "+timeline+" days.",expected,grade:(o:unknown)=>{const x=o as Record<string,unknown>;const valid=typeof x?.isQualified==="boolean"&&typeof x?.budgetUsd==="number"&&typeof x?.preferredArea==="string"&&Number.isInteger(x?.timelineDays);return {schemaValid:valid,taskCorrect:valid&&x.isQualified===qualified&&x.budgetUsd===budget&&x.preferredArea===area&&x.timelineDays===timeline};}};
});
const extractions=Array.from({length:20},(_,i)=>{
 const email="buyer"+(i+1)+"@example.test",phone="+234800000"+(100+i),budget=210000+i*19750,area=["Lekki","Yaba","Ikeja","Ajah","Ikoyi"][i%5],days=14+(i*11)%180;
 const expected={email,phone,budgetUsd:budget,preferredArea:area,moveInDays:days};
 return {id:"extract-"+(i+1),task:"data_extraction" as const,prompt:"Extract JSON fields email,phone,budgetUsd,preferredArea,moveInDays from this enquiry: "+email+" "+phone+" budget $"+budget+" area "+area+" move-in "+days+" days.",expected,grade:(o:unknown)=>{const x=o as Record<string,unknown>;const valid=typeof x?.email==="string"&&typeof x?.phone==="string"&&typeof x?.budgetUsd==="number"&&typeof x?.preferredArea==="string"&&Number.isInteger(x?.moveInDays);return {schemaValid:valid,taskCorrect:valid&&Object.entries(expected).every(([k,v])=>x[k]===v)};}};
});
export const AI_QUALITY_BENCHMARK_CASES:AIQualityCase[]=[...leads,...extractions];
export function getAIQualityCases(task:AITask){return AI_QUALITY_BENCHMARK_CASES.filter(x=>x.task===task);}
