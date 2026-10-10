import type { ReactNode } from "react";
import "./session.css";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <form className="session-signout" action="/auth/signout" method="post">
        <span aria-hidden="true">⌑</span>
        <button type="submit">Sign out</button>
      </form>
    </>
  );
}
