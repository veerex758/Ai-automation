import type { ReactNode } from "react";
import "./dashboard.css";
import "./session.css";
import SessionExpiryGuard from "./session-expiry-guard";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SessionExpiryGuard />
      {children}
      <form className="session-signout" action="/auth/signout" method="post">
        <span aria-hidden="true">⌑</span>
        <button type="submit">Sign out</button>
      </form>
    </>
  );
}
