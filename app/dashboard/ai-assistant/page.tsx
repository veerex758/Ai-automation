"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "./assistant.css";

type GeneratedNode = { id: string; type: "trigger" | "action" | "condition"; title: string; description: string; settings: Record<string, string> };
type Draft = { version: 1; nodes: GeneratedNode[] };
type RegistryDraftStep = { id: string; nodeId: string; operationId: string; kind: "trigger" | "action"; input: Record<string, unknown> };
type ChatMessage = { role: "user" | "assistant"; content: string };

export default function AIAssistantPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [registrySteps, setRegistrySteps] = useState<RegistryDraftStep[] | null>(null);
  const [summary, setSummary] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("Your workspace");

  useEffect(() => {
    let active = true;
    void fetch("/api/workflows", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) return;
        const result = await response.json() as { workspace?: { name?: string } };
        if (active && typeof result.workspace?.name === "string") setWorkspa¶»§q«^