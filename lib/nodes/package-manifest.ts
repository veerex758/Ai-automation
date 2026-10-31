import { z } from "zod";

export const NODE_PACKAGE_PERMISSIONS = [
  "connector.invoke",
  "http.outbound",
  "workspace.storage.read",
  "workspace.storage.write",
  "trigger.register",
  "schedule.register",
  "logger.write",
] as const;

export const nodePackageManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packageName: z.string().regex(/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/, "Use a scoped npm package name."),
  packageVersion: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Pin an exact stable semantic version."),
  displayName: z.string().trim().min(2).max(80),
  description: z.string().trim().min(20).max(500),
  publisher: z.object({
    name: z.string().trim().min(2).max(100),
    url: z.string().url().max(2048),
  }).strict(),
  runtimeApiVersion: z.literal(1),
  entrypoint: z.string().regex(/^dist\/[a-zA-Z0-9._/-]+\.js$/).refine((value) => !value.includes(".."), "Entrypoint traversal is not allowed."),
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/, "A SHA-512 package integrity digest is required."),
  permissions: z.array(z.enum(NODE_PACKAGE_PERMISSIONS)).max(7).refine((items) => new Set(items).size === items.length, "Permissions must be unique."),
  installPolicy: z.literal("no-scripts"),
  nativeDependencies: z.literal(false),
}).strict();

export type NodePackageManifest = z.infer<typeof nodePackageManifestSchema>;

export function validateNodePackageManifest(value: unknown): NodePackageManifest {
  return nodePackageManifestSchema.parse(value);
}

/**
 * Community packages are never loaded into the Next.js process. This manifest
 * is only a declaration; publisher verification, registry approval, artifact
 * scanning and sandbox execution are separate mandatory installation gates.
 */
export const COMMUNITY_NODE_INSTALL_GATES = [
  "publisher_verified",
  "registry_review_approved",
  "exact_version_and_integrity_pinned",
  "dependency_and_malware_scan_passed",
  "permission_review_approved",
  "isolated_worker_available",
] as const;
