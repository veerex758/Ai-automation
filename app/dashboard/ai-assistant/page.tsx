import { redirect } from "next/navigation";

export default function LegacyAIAssistantRedirect() {
  redirect("/dashboard/playbooks/new");
}
