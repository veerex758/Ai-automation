import { NextResponse } from "next/server";
import { getPublicNodeCatalog } from "@/nodes/registry";

/** Public, secret-free registry metadata used by the workflow canvas. */
export async function GET() {
  return NextResponse.json({ version: 1, nodes: getPublicNodeCatalog() }, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
