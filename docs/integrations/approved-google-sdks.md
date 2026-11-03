# Approved Google integration SDKs

These are official Google- and Slack-maintained API client packages, not third-party n8n community packages. Aivanta uses its own node definitions, schemas, credential vault, and runner; it does not load n8n node source code.

| Package | Pinned version | License | Purpose |
| --- | --- | --- | --- |
| `@googleapis/gmail` | `22.0.2` | Apache-2.0 | Gmail API client |
| `@googleapis/sheets` | `18.1.2` | Apache-2.0 | Google Sheets API client |
| `@slack/web-api` | `8.2.0` | MIT | Slack Web API client |

## Review notes

- Package ownership/source: Google's `googleapis/google-api-nodejs-client` repository and Slack's `slackapi/node-slack-sdk` repository.
- Versions are exact pins, not floating semver ranges.
- npm package metadata reports Apache-2.0 for both packages; the package pages identify Google as publisher/maintainer.
- The scoped Gmail package reports one runtime dependency (`googleapis-common`); the Sheets package is an official generated Google API client. Slack's SDK is the vendor-supported Web API client.
- No n8n community package is installed or dynamically loaded.
- CI dependency installation and vulnerability checks must complete before merge. This change does not connect a Google account or grant OAuth scopes.

## Runtime boundary

Adding these SDKs does not make Gmail or Sheets actions available by itself. Aivanta still needs a reviewed OAuth connection flow, encrypted token storage/refresh, explicit least-privilege scopes, and native node schemas/adapters. Until those are implemented and tested, these packages are dependencies only and no Google API call is made.
