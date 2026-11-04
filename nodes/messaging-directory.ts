import { z } from "zod";
import type { NodeDefinition } from "./types";

const required = (max = 4000) => z.string().trim().min(1).max(max);
const notConfigured = (provider: string) => async () => { throw new Error(provider.toUpperCase() + "_ADAPTER_NOT_CONFIGURED"); };

export const messagingDirectoryNodes: NodeDefinition[] = [
  {
    id: "signal", name: "Signal", icon: "message-circle", category: "communication", version: 1,
    auth: { type: "connectionString", credentialKey: "bridgeUrl" }, triggers: [], actions: [{
      id: "send_message", name: "Send message", description: "Signal has no supported hosted public bot API. Requires a separately deployed, authenticated Signal bridge and an egress-restricted adapter; not executable in this build.",
      inputSchema: z.object({ recipient: z.string().regex(/^\+?[1-9]\d{6,14}$/), message: required(4000) }).strict(),
      outputSchema: z.object({ messageId: z.string() }).strict(),
      run: notConfigured("signal"),
    }],
  },
  {
    id: "matrix", name: "Matrix", icon: "messages-square", category: "communication", version: 1,
    auth: { type: "connectionString", credentialKey: "homeserverUrl" }, triggers: [], actions: [{
      id: "send_room_message", name: "Send room message", description: "Matrix homeservers are user-controlled. A production adapter must validate HTTPS origins against SSRF/private-network rules and scope access tokens to the workspace; not executable in this build.",
      inputSchema: z.object({ roomId: required(255), message: required(16000) }).strict(),
      outputSchema: z.object({ eventId: z.string() }).strict(),
      run: notConfigured("matrix"),
    }],
  },
  {
    id: "mattermost", name: "Mattermost", icon: "message-square", category: "communication", version: 1,
    auth: { type: "connectionString", credentialKey: "serverUrl" }, triggers: [], actions: [{
      id: "create_post", name: "Create channel post", description: "Mattermost server URLs are customer-controlled. A production adapter must enforce SSRF-safe host allowlisting and workspace token scoping; not executable in this build.",
      inputSchema: z.object({ channelId: required(100), message: required(16000) }).strict(),
      outputSchema: z.object({ postId: z.string() }).strict(),
      run: notConfigured("mattermost"),
    }],
  },
];
