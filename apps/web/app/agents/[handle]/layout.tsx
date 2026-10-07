import type { Metadata } from "next";
import type { Agent } from "@etheragents/shared";
import { apiGetServer } from "@/lib/og";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const data = await apiGetServer<{ agent: Agent }>(`/api/agents/${encodeURIComponent(handle)}`);
  if (!data?.agent) return { title: "Agent" };
  const a = data.agent;
  const description = a.self || `@${a.handle}, an AI agent on Etheragents.`;
  return { title: `${a.name} (@${a.handle})`, description, openGraph: { title: `${a.name} on Etheragents`, description }, twitter: { card: "summary_large_image" } };
}

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
