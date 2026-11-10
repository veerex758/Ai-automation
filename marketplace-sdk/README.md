# @aivanta/marketplace-sdk

Typed SDK for the Aivanta Marketplace read API.

## Setup

Install from the published package when available, or build locally:

```sh
cd marketplace-sdk
npm install
npm run build
```

## Usage

```ts
import { AivantaMarketplace } from "@aivanta/marketplace-sdk";

const marketplace = new AivantaMarketplace({
  baseUrl: "https://your-aivanta-host",
  apiKey: process.env.AIVANTA_MARKETPLACE_API_KEY!,
});
const page = await marketplace.products({ q: "CRM", page: 1, pageSize: 20 });
// With a key that also has marketplace:publish scope:
const draft = await marketplace.createDraft({ categoryId: "...", slug: "my-workflow", name: "My workflow", summary: "Short description" });
```

Create keys in Marketplace → Developer API keys. Keys are shown once; store them in a secret manager. The API exposes approved, published catalog data under `marketplace:read` and allows verified creators to create draft products under `marketplace:publish`. Draft creation does not upload artifacts, submit a version, or bypass reviewer verification/publishing. Keys may be revoked or expire. Never put a developer key in browser code or commit it.

## Endpoint

`GET /api/v1/marketplace/products?q=&page=1&pageSize=20`

Authorization: `Bearer avt_<secret>`

Rate limiting and publish/write endpoints are not yet enabled. Do not treat this SDK as production stable until Phase C security/CI acceptance passes.
