import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const url = request.nextUrl;
    let query = supabase.from("marketplace_products")
      .select("id,slug,name,summary,product_type,pricing_type,recurring_interval,price_minor,currency,required_plan,integrations,permissions,expected_usage,published_at,category:marketplace_categories(name,slug),creator:marketplace_creators(display_name,slug)")
    const q = (url.searchParams.get("q") ?? "").replace(/[^\p{L}\p{N}\s_-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    const category = url.searchParams.get("category");
    const type = url.searchParams.get("type");
    if (category) query = query.eq("marketplace_categories.slug", category);
    if (type && ["workflow", "pack", "agent"].includes(type)) query = query.eq("product_type", type);
    if (q) query = query.or(`name.ilike.%${q}%,summary.ilike.%${q}%`);
    const { data, error } = await query.limit(60);
    if (error) throw error;
    return NextResponse.json({ products: data ?? [] }, { headers });
  } catch (error) {
    console.error("Marketplace catalog failed", error);
    return NextResponse.json({ error: "Marketplace catalog is temporarily unavailable." }, { status: 500, headers });
  }
}
