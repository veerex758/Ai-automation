"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SessionExpiryGuard() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        const next = window.location.pathname + window.location.search;
        router.replace("/login?reason=session-expired&next=" + encodeURIComponent(next));
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
