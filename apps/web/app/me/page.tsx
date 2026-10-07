"use client";
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keccak256, parseEther, toBytes, type Address } from "viem";
import { useConfig } from "wagmi";
import { readContract, sendTransaction, signMessage, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { PERSONA_MAX, agentVaultAbi, controlMessage, explorerAddress, type Agent } from "@etheragents/shared";
import { useMyAgents, useStats } from "@/lib/queries";
import { useOwner } from "@/lib/owner";
import { apiPost, errMsg } from "@/lib/api";
import { ensureChain } from "@/lib/chain";
import { CHAIN_ID } from "@/lib/config";
import { fmtEth, shortAddr, signClass } from "@/lib/format";
import { WalletButton } from "@/components/WalletButton";
import { Avatar, Empty, ErrorState, ExtLink, Skeleton, StatusBadge } from "@/components/ui";

type Panel = null | "deposit" | "withdraw" | "limits" | "persona";

function parseEth(s: string): bigint | null {
  try {
    if (!/^\d*\.?\d+$/.test(s.trim())) return null;
    return parseEther(s.trim() as `${number}`);
  } catch {
    return null;
  }
}

function AgentManager({ a, sim }: { a: Agent; sim: boolean }) {
  const config = useConfig();
  const qc = useQueryClient();
  const { data: stats } = useStats();
  const { address: owner, kind } = useOwner();
  const chainId = stats?.chainId ?? CHAIN_ID;
  const [panel, setPanel] = useState<Panel>(null);
  const [amount, setAmount] = useState("0.05");
  const [maxTrade, setMaxTrade] = useState("");
  const [daily, setDaily] = useState("");
  const [persona, setPersona] = useState(a.persona);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const chainOk = !sim && kind === "wallet";

  const refresh = (agent?: Agent) => {
    if (agent) {
      qc.setQueriesData<{ agents: Agent[] }>({ queryKey: ["me"] }, (old) => (old ? { agents: old.agents.map((x) => (x.id === agent.id ? agent : x)) } : old));
    }
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.invalidateQueries({ queryKey: ["agent"] });
  };

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setMsg(null);
    try {
      const done = await fn();
      setMsg({ ok: true, text: done || "Done." });
      setPanel(null);
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  const tx = async (send: () => Promise<`0x${string}`>) => {
    await ensureChain(config, chainId);
    setBusy("Confirm in your wallet…");
    const hash = await send();
    setBusy("Waiting for confirmation…");
    const r = await waitForTransactionReceipt(config, { hash, chainId });
    if (r.status !== "success") throw new Error("Transaction reverted");
    refresh();
  };

  const control = async (action: "sleep" | "wake" | "persona", extra: { persona?: string } = {}) => {
    const nonce = Date.now();
    const actionStr = action === "persona" ? `persona:${keccak256(toBytes(extra.persona ?? ""))}` : action;
    let signature = "sim";
    if (!sim || kind === "wallet") {
      if (kind !== "wallet") throw new Error("Connect the owner wallet to sign.");
      setBusy("Sign the message in your wallet…");
      signature = await signMessage(config, { message: controlMessage(a.id, actionStr, nonce) });
    }
    setBusy("Sending…");
    const res = await apiPost<{ agent: Agent }>(`/api/agents/${a.id}/control`, { action, ...extra, nonce, signature });
    refresh(res.agent);
  };

  const simFund = async (eth: number) => {
    const res = await apiPost<{ agent: Agent }>("/api/sim/fund", { owner, agentId: a.id, eth });
    refresh(res.agent);
  };

  const deposit = () =>
    run("Depositing…", async () => {
      const wei = parseEth(amount);
      if (!wei || wei <= 0n) throw new Error("Enter an amount above 0.");
      if (sim) await simFund(Number(amount));
      else await tx(() => sendTransaction(config, { to: a.vault as Address, value: wei, chainId }));
      return `Deposited ${fmtEth(Number(amount))} into @${a.handle}'s vault.`;
    });

  const withdraw = () =>
    run("Withdrawing…", async () => {
      const wei = parseEth(amount);
      if (!wei || wei <= 0n) throw new Error("Enter an amount above 0.");
      if (Number(amount) > a.balanceEth + 1e-12) throw new Error(`The vault only holds ${fmtEth(a.balanceEth)}.`);
      if (sim) await simFund(-Number(amount));
      else await tx(() => writeContract(config, { address: a.vault as Address, abi: agentVaultAbi, functionName: "withdrawETH", args: [owner as Address, wei], chainId }));
      return `Withdrew ${fmtEth(Number(amount))} to your wallet.`;
    });

  const setPaused = (p: boolean) =>
    run(p ? "Pausing…" : "Unpausing…", async () => {
      await tx(() => writeContract(config, { address: a.vault as Address, abi: agentVaultAbi, functionName: "setPaused", args: [p], chainId }));
      return p ? "Vault paused. The agent can't trade until you unpause it." : "Vault unpaused.";
    });

  const openLimits = async () => {
    setPanel(panel === "limits" ? null : "limits");
    if (!chainOk || maxTrade) return;
    try {
      const [m, d] = await Promise.all([
        readContract(config, { address: a.vault as Address, abi: agentVaultAbi, functionName: "maxTradeWei", chainId }),
        readContract(config, { address: a.vault as Address, abi: agentVaultAbi, functionName: "dailyLimitWei", chainId }),
      ]);
      setMaxTrade(String(Number(m as bigint) / 1e18));
      setDaily(String(Number(d as bigint) / 1e18));
    } catch {
      /* leave empty */
    }
  };

  const saveLimits = () =>
    run("Updating limits…", async () => {
      const m = parseEth(maxTrade);
      const d = parseEth(daily);
      if (m === null || d === null || m <= 0n || d < m) throw new Error("Max per trade must be above 0 and the daily limit at least as large.");
      await tx(() => writeContract(config, { address: a.vault as Address, abi: agentVaultAbi, functionName: "setLimits", args: [m, d], chainId }));
      return "Limits updated.";
    });

  const vaultLink = explorerAddress(chainId, a.vault);

  return (
    <section className="panel my-agent">
      <div className="row wrap" style={{ gap: 14 }}>
        <Link href={`/agents/${a.handle}`} className="who">
          <Avatar seed={a.avatar} color={a.color} size={48} alt={a.name} />
          <span>
            <span className="n" style={{ display: "block", fontSize: 17 }}>{a.name}</span>
            <span className="h">@{a.handle}</span>
          </span>
        </Link>
        <span className="spacer" />
        <StatusBadge agent={a} />
      </div>
      <div className="figs">
        <div className="fig"><div className="k">Vault balance</div><div className="v">{fmtEth(a.balanceEth)}</div></div>
        <div className="fig"><div className="k">Holdings</div><div className="v">{fmtEth(a.holdingsEth)}</div></div>
        <div className="fig"><div className="k">Realized PnL</div><div className={`v ${signClass(a.realizedEth)}`}>{fmtEth(a.realizedEth, { sign: true })}</div></div>
        <div className="fig"><div className="k">Vault</div><div className="v addr">{vaultLink ? <ExtLink href={vaultLink}>{shortAddr(a.vault)}</ExtLink> : shortAddr(a.vault)}</div></div>
      </div>
      {a.thought && <p className="quote"><span>Latest thought: </span>{a.thought.length > 180 ? a.thought.slice(0, 180) + "…" : a.thought}</p>}

      <div className="controls">
        <button className="btn sm" onClick={() => setPanel(panel === "deposit" ? null : "deposit")} disabled={!!busy}>Deposit</button>
        <button className="btn sm" onClick={() => setPanel(panel === "withdraw" ? null : "withdraw")} disabled={!!busy}>Withdraw</button>
        {a.asleep ? (
          <button className="btn sm" onClick={() => run("Waking…", async () => { await control("wake"); return `@${a.handle} is waking up.`; })} disabled={!!busy}>Wake</button>
        ) : (
          <button className="btn sm" onClick={() => run("Putting to sleep…", async () => { await control("sleep"); return `@${a.handle} is asleep. It won't act until you wake it.`; })} disabled={!!busy}>Sleep</button>
        )}
        <button className="btn sm" onClick={() => setPanel(panel === "persona" ? null : "persona")} disabled={!!busy}>Edit persona</button>
        {!sim && (
          <>
            <button className="btn sm" onClick={openLimits} disabled={!!busy || !chainOk}>Limits</button>
            {a.paused ? (
              <button className="btn sm" onClick={() => setPaused(false)} disabled={!!busy || !chainOk}>Unpause vault</button>
            ) : (
              <button className="btn sm danger" onClick={() => setPaused(true)} disabled={!!busy || !chainOk}>Pause vault</button>
            )}
          </>
        )}
        <Link className="btn sm ghost" href={`/agents/${a.handle}`}>Profile</Link>
      </div>

      {(panel === "deposit" || panel === "withdraw") && (
        <div className="ctl-panel">
          <div className="ctl-row">
            <div className="field">
              <label htmlFor={`amt-${a.id}`}>{panel === "deposit" ? "Deposit into the vault" : "Withdraw to your wallet"}</label>
              <div className="input-affix right">
                <input id={`amt-${a.id}`} className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <span className="affix">ETH</span>
              </div>
            </div>
            {panel === "withdraw" && <button className="btn" style={{ height: 40 }} onClick={() => setAmount(String(Math.floor(a.balanceEth * 1e6) / 1e6))}>Max</button>}
            <button className="btn primary" style={{ height: 40 }} onClick={panel === "deposit" ? deposit : withdraw} disabled={!!busy}>
              {panel === "deposit" ? "Deposit" : "Withdraw"}
            </button>
          </div>
          {sim && <span className="hint">Simulation: balances are simulated ETH.</span>}
        </div>
      )}
      {panel === "limits" && (
        <div className="ctl-panel">
          <div className="ctl-row">
            <div className="field">
              <label>Max per trade (ETH)</label>
              <input className="input num" inputMode="decimal" value={maxTrade} onChange={(e) => setMaxTrade(e.target.value)} placeholder="0.01" />
            </div>
            <div className="field">
              <label>Daily limit (ETH)</label>
              <input className="input num" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="0.05" />
            </div>
            <button className="btn primary" style={{ height: 40 }} onClick={saveLimits} disabled={!!busy}>Save limits</button>
          </div>
        </div>
      )}
      {panel === "persona" && (
        <div className="ctl-panel">
          <div className="field">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <label htmlFor={`p-${a.id}`}>Persona</label>
              <span className={`counter${persona.length > PERSONA_MAX ? " over" : ""}`}>{persona.length}/{PERSONA_MAX}</span>
            </div>
            <textarea id={`p-${a.id}`} className="textarea" value={persona} onChange={(e) => setPersona(e.target.value)} style={{ minHeight: 180 }} />
          </div>
          <div className="row">
            <button
              className="btn primary"
              disabled={!!busy || persona.trim().length < 40 || persona.length > PERSONA_MAX || persona === a.persona}
              onClick={() => run("Saving persona…", async () => { await control("persona", { persona }); return "Persona updated. The agent reads it on its next tick."; })}
            >
              Save persona
            </button>
            <button className="btn ghost" onClick={() => { setPersona(a.persona); setPanel(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {busy && <div className="notice busy" role="status"><span className="live-dot" aria-hidden />{busy}</div>}
      {msg && <div className={`notice ${msg.ok ? "ok" : "error"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
      {!sim && kind !== "wallet" && <div className="notice">Connect the owner wallet to sign and send transactions.</div>}
    </section>
  );
}

export default function MePage() {
  const { address, kind, useDemo } = useOwner();
  const { data: stats } = useStats();
  const sim = stats?.mode === "sim";
  const { data, isLoading, error, refetch } = useMyAgents(address);
  const agents = data?.agents ?? [];

  return (
    <main>
      <div className="container narrow">
        <div className="page-head">
          <div>
            <h1>My agents</h1>
            <p>Your agents run themselves. From here you fund them, pull ETH out, change their limits, put them to sleep or rewrite who they are.</p>
          </div>
          {address && <Link className="btn primary" href="/create">Create agent</Link>}
        </div>
        {!address ? (
          <section className="panel">
            <Empty
              title="Connect to see your agents"
              action={
                <div className="row wrap" style={{ justifyContent: "center" }}>
                  <WalletButton />
                  {sim && <button className="btn primary" onClick={useDemo}>Use demo wallet</button>}
                </div>
              }
            >
              {sim ? "This is a simulation: connect a wallet, or use a demo wallet to try everything without one." : "Agents are listed by the wallet that created them."}
            </Empty>
          </section>
        ) : isLoading ? (
          <div className="stack">{[0, 1].map((i) => <div key={i} className="panel my-agent"><Skeleton w="40%" h={20} /><Skeleton h={40} /><Skeleton w="70%" h={28} /></div>)}</div>
        ) : error && !agents.length ? (
          <section className="panel"><ErrorState error={error} retry={() => refetch()} /></section>
        ) : !agents.length ? (
          <section className="panel">
            <Empty title="You don't have an agent yet" action={<Link className="btn primary" href="/create">Create your first agent</Link>}>
              It takes about a minute: a name, a persona and some ETH for its vault.
            </Empty>
          </section>
        ) : (
          <div className="stack">
            {kind === "demo" && <div className="notice">You&apos;re using a demo wallet ({shortAddr(address)}). Everything here is simulated.</div>}
            {agents.map((a) => <AgentManager key={a.id} a={a} sim={sim} />)}
          </div>
        )}
      </div>
    </main>
  );
}
