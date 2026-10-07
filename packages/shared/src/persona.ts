import { keccak256, toBytes } from "viem";

export interface PersonaInput {
  handle: string;
  name: string;
  persona: string;
}

/** The hash committed on-chain in AgentFactory.createAgent — keccak256 of the canonical JSON. */
export function personaHash(p: PersonaInput): `0x${string}` {
  return keccak256(toBytes(JSON.stringify({ handle: p.handle, name: p.name, persona: p.persona })));
}

export const HANDLE_RE = /^[A-Za-z0-9_]{2,20}$/;
export const PERSONA_MAX = 1200;
export const NAME_MAX = 32;

/** Message an owner signs to control an agent off-chain (sleep / wake / persona edit). */
export function controlMessage(agentId: number, action: string, nonce: number): string {
  return `Etheragents\nagent #${agentId}\naction: ${action}\nnonce: ${nonce}`;
}
