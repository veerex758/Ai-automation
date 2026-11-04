import { z } from "zod";
import type { NodeDefinition } from "./types";

const MAX_CODE_BYTES = 20_000;
const MAX_INPUT_BYTES = 16_000;
const MAX_RESULT_BYTES = 24_000;
const MAX_LOG_BYTES = 8_000;

const inputSchema = z.object({
  code: z.string().min(1).max(MAX_CODE_BYTES),
  input: z.record(z.string(), z.unknown()).default({}),
  timeoutMs: z.number().int().min(1_000).max(30_000).default(10_000),
}).strict();

type JavaScriptInput = z.infer<typeof inputSchema>;
type SandboxOptions = {
  image: string;
  resources: { vcpus: 1 };
  timeout: number;
  persistent: false;
  networkPolicy: "deny-all";
  env: Record<string, string>;
};
type SandboxHandle = {
  runCommand(args: { cmd: string; args: string[]; env?: Record<string, string> }): Promise<{
    exitCode: number | null;
    stdout(): Promise<string>;
  }>;
  stop(): Promise<unknown>;
};
type SandboxFactory = (options: SandboxOptions) => Promise<SandboxHandle>;

const runnerSource = `
const rawStdoutWrite = process.stdout.write.bind(process.stdout);
let stdoutBytes = 0;
process.stdout.write = (chunk, ...args) => {
  const size = Buffer.byteLength(typeof chunk === "string" ? chunk : chunk.toString());
  if (stdoutBytes + size > 40000) return true;
  stdoutBytes += size;
  return rawStdoutWrite(chunk, ...args);
};
process.stderr.write = () => true;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const code = process.argv[1];
const input = JSON.parse(process.argv[2]);
const logs = [];
let logBytes = 0;
const safeLog = (...values) => {
  if (logs.length >= 50 || logBytes >= 8000) return;
  const line = values.map((value) => {
    try { return typeof value === "string" ? value : JSON.stringify(value); }
    catch { return "[unserializable]"; }
  }).join(" ").slice(0, 2000);
  const remaining = 8000 - logBytes;
  const bounded = line.slice(0, remaining);
  logs.push(bounded);
  logBytes += Buffer.byteLength(bounded, "utf8");
};
const safeConsole = { log: safeLog, info: safeLog, warn: safeLog, error: safeLog, debug: safeLog };
globalThis.console = safeConsole;
(async () => {
  try {
    const execute = new AsyncFunction("input", "console", code);
    const value = await execute(input, safeConsole);
    const serialized = JSON.stringify(value === undefined ? null : value);
    if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > 24000) {
      throw new Error("JAVASCRIPT_RESULT_TOO_LARGE_OR_NOT_SERIALIZABLE");
    }
    process.stdout.write(JSON.stringify({ ok: true, result: JSON.parse(serialized), logs }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: error && typeof error.message === "string" ? error.message.slice(0, 300) : "JAVASCRIPT_EXECUTION_FAILED",
      logs,
    }));
    process.exitCode = 1;
  }
})();
`;

export async function executeJavaScriptInSandbox(
  args: unknown,
  createSandbox: SandboxFactory = async (options) => {
    const { Sandbox: VercelSandbox } = await import("@vercel/sandbox");
    return VercelSandbox.create(options);
  },
) {
  const parsed = inputSchema.parse(args);
  const inputJson = JSON.stringify(parsed.input);
  if (Buffer.byteLength(parsed.code, "utf8") > MAX_CODE_BYTES ||
      Buffer.byteLength(inputJson, "utf8") > MAX_INPUT_BYTES) {
    throw new Error("JAVASCRIPT_INPUT_TOO_LARGE");
  }

  const sandbox = await createSandbox({
    image: "vercel/sandbox/node:24",
    resources: { vcpus: 1 },
    timeout: parsed.timeoutMs,
    persistent: false,
    networkPolicy: "deny-all",
    env: {},
  });
  const startedAt = Date.now();
  let completed = false;
  try {
    const command = await sandbox.runCommand({
      cmd: "node",
      args: ["--permission", "-e", runnerSource, parsed.code, inputJson],
    });
    const stdout = await command.stdout();
    if (command.exitCode !== 0) {
      throw new Error("JAVASCRIPT_EXECUTION_FAILED");
    }
    if (Buffer.byteLength(stdout, "utf8") > MAX_RESULT_BYTES + MAX_LOG_BYTES + 1024) {
      throw new Error("JAVASCRIPT_OUTPUT_TOO_LARGE");
    }
    let payload: unknown;
    try { payload = JSON.parse(stdout); }
    catch { throw new Error("JAVASCRIPT_SANDBOX_INVALID_OUTPUT"); }
    if (!payload || typeof payload !== "object" || (payload as Record<string, unknown>).ok !== true) {
      const message = payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).error === "string"
        ? (payload as Record<string, string>).error
        : "JAVASCRIPT_EXECUTION_FAILED";
      throw new Error(message);
    }
    const result = (payload as Record<string, unknown>).result ?? null;
    const logs = Array.isArray((payload as Record<string, unknown>).logs)
      ? (payload as { logs: string[] }).logs.filter((line) => typeof line === "string").slice(0, 50)
      : [];
    completed = true;
    return { result, logs, executionMs: Date.now() - startedAt };
  } finally {
    try {
      await sandbox.stop();
    } catch {
      if (completed) throw new Error("JAVASCRIPT_SANDBOX_CLEANUP_FAILED");
    }
  }
}

export const javascriptNode: NodeDefinition = {
  id: "javascript",
  name: "Code (JavaScript)",
  icon: "code",
  category: "developer",
  version: 1,
  auth: { type: "none" },
  triggers: [],
  actions: [{
    id: "execute",
    name: "Run JavaScript in an isolated sandbox",
    description: "Executes bounded JavaScript in a disposable Vercel Firecracker microVM with network access and Node filesystem permissions denied; no workspace credentials are passed into the runtime.",
    inputSchema,
    outputSchema: z.object({
      result: z.unknown(),
      logs: z.array(z.string()).max(50),
      executionMs: z.number().int().nonnegative(),
    }).strict(),
    async run(_context, input) {
      return executeJavaScriptInSandbox(input);
    },
  }],
};
