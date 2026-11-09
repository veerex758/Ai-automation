import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { invokeCommunityNode, verifyCommunityWorkerSignature } from "../lib/nodes/community-worker";

test("community worker signatures bind timestamp, nonce, and exact request body", () => {
  const secret = "test-secret-that-is-at-least-32-characters-long";
  const timestamp = String(Date.now());
  const nonce = "unique-request-nonce";
  const body = JSON.stringify({ invocationId: "inv-1", input: { value: 3 } });
  const signature = createHmac("sha256", secret).update(timestamp + "." + nonce + "." + body).digest("hex");
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp, nonce, body, signature }), true);
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp, nonce, body: body + " ", signature }), false);
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp, nonce: nonce + "x", body, signature }), false);
});

test("community worker signature rejects stale timestamps and malformed digests", () => {
  const secret = "test-secret-that-is-at-least-32-characters-long";
  const timestamp = String(Date.now() - 60_000);
  const nonce = "nonce";
  const body = "{}";
  const signature = createHmac("sha256", secret).update(timestamp + "." + nonce + "." + body).digest("hex");
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp, nonce, body, signature }), false);
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp: "NaN", nonce, body, signature }), false);
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp: String(Date.now()), nonce, body, signature: "bad" }), false);
});

test("community worker invocation rejects malformed identifiers before network access", async () => {
  await assert.rejects(invokeCommunityNode({
    packageVersionId: "not-a-uuid", integrity: "sha512-" + "A".repeat(88),
    entrypoint: "dist/index.js", operation: "run", input: {},
    permissions: [], workspaceId: "not-a-uuid", installationId: "not-a-uuid",
  }), /COMMUNITY_NODE_INVOCATION_INVALID/);
});

test("community worker invocation rejects path traversal and malformed integrity", async () => {
  const valid = {
    packageVersionId: "00000000-0000-4000-8000-000000000001",
    integrity: "sha512-" + "A".repeat(88), entrypoint: "dist/index.js", operation: "run",
    input: {}, permissions: [], workspaceId: "00000000-0000-4000-8000-000000000002",
    installationId: "00000000-0000-4000-8000-000000000003",
  };
  await assert.rejects(invokeCommunityNode({...valid, entrypoint: "dist/../index.js"}), /COMMUNITY_NODE_ENTRYPOINT_INVALID/);
  await assert.rejects(invokeCommunityNode({...valid, integrity: "sha256-invalid"}), /COMMUNITY_NODE_INTEGRITY_INVALID/);
});
