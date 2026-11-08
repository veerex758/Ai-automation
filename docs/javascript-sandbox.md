# Aivanta JavaScript sandbox

Aivanta's `javascript.execute` action runs user- or AI-authored JavaScript in a disposable Vercel Sandbox Firecracker microVM. It is invoked only by the durable workflow worker.

## Enablement

Execution is deliberately disabled unless the server environment contains:

```env
AIVANTA_LIVE_EXECUTION_ENABLED=true
AIVANTA_JAVASCRIPT_SANDBOX_ENABLED=true
```

The workflow must also be active and pass the existing live-execution gates. Do not enable this on Production until the staging workflow has been accepted.

On Vercel, the Sandbox SDK authenticates with the deployment's Vercel OIDC identity. For local development, use a fresh Vercel development OIDC token from `vercel env pull`, or provide all three server-side values:

```env
VERCEL_TOKEN=...
VERCEL_TEAM_ID=...
VERCEL_PROJECT_ID=...
```

The implementation passes these values only to the Sandbox control-plane SDK. They are not included in the sandbox environment or command environment. Never add them to workflow input, node output, browser-visible settings, or logs.

## Runtime restrictions

- Disposable `vercel/sandbox/node:24` image, one vCPU, non-persistent session.
- Network egress denied at the microVM firewall.
- Maximum requested session timeout: 30 seconds (default 10 seconds).
- Node permission model enabled; no application/workspace credentials are passed to the guest.
- Code and JSON input are bounded before provisioning.
- Stdout and stderr use separate bounded host-side streams; output overflow aborts the command, while logs and returned JSON are separately bounded.
- The sandbox is stopped in a `finally` block. A cleanup failure after successful execution is surfaced as an execution failure.
- Direct registry-run endpoint does not permit live JavaScript execution. The durable worker checks the explicit JavaScript enablement flag.

## Testing and rollout

Unit tests inject a mock sandbox factory. They verify the requested isolation options, no guest environment variables, cleanup on success/failure, input limits, and streamed output limits without creating billable sandboxes.

Before enabling in staging, confirm the Vercel project has Sandbox entitlement and OIDC access, set the two Aivanta flags for Preview only, and run a tiny no-network test workflow. Do not enable Production or scheduled live execution as part of this step. Sandbox usage is separate from deployment creation and may incur usage charges.
