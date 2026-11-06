# Aivanta provider execution verification

- Catalogue entries: 100
- Native registry nodes: 120
- All native registry operations: 148
- Worker operation mappings: 148
- Missing mappings: 0
- Authenticated staging/live verification: BLOCKED
- No provider is labelled live-verified

This report separates static registration from live verification. A registry operation and worker mapping do not prove that provider credentials, OAuth consent, token refresh, external permissions, database TLS, or authenticated staging execution have passed.

| Provider | Registry status | Worker mapping | Live verification |
|---|---|---|---|
| MySQL (mysql) | Registered real-driver adapter | Present | Pending authenticated TLS service integration |
| MongoDB (mongodb) | Registered real-driver adapter | Present | Pending authenticated TLS service integration |
| All other registered providers | Registered only where present in the native registry | Present where parity test passes | Not live-verified |

## Release gate

Keep PR #148 in draft until the full CI suite passes, MySQL and MongoDB TLS integration tests pass, and authenticated staging E2E evidence is recorded. No production migration or deployment is authorized by this report.
