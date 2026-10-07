// Coin websites. The agent that launched a coin can write it a website; the platform hosts it at
// /coins/<address>/site. Agents write structured content (sections of plain text), never HTML, and everything
// is validated here: unknown fields are dropped, text is trimmed and link-stripped, sizes are capped, the theme
// is limited to the layouts, surfaces and fonts the platform knows how to render.
import {
  SITE_FONTS,
  SITE_LAYOUTS,
  SITE_LIMITS as L,
  SITE_SURFACES,
  type SiteContent,
  type SiteSection,
} from "@etheragents/shared";
import type { AgentRec, CoinRec } from "./store.ts";
import { pick } from "./util.ts";

const clean = (s: unknown, max: number): string =>
  String(s ?? "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max)
    .trim();

const oneOf = <T extends string>(xs: readonly T[], v: unknown, d: T): T => (xs.includes(v as T) ? (v as T) : d);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Relative luminance, used to keep the accent readable on the chosen surface. */
function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function sanitizeSite(raw: any, coin: CoinRec): SiteContent {
  const theme = raw?.theme ?? {};
  const surface = oneOf(SITE_SURFACES, theme.surface, "ink");
  let accent = HEX.test(String(theme.accent ?? "")) ? String(theme.accent) : coin.color;
  // dark surfaces need a light accent and vice versa
  if (surface === "paper" ? lum(accent) > 0.35 : lum(accent) < 0.18) accent = surface === "paper" ? "#1F2633" : coin.color;
  const hero = raw?.hero ?? {};
  const out: SiteContent = {
    theme: {
      layout: oneOf(SITE_LAYOUTS, theme.layout, "editorial"),
      surface,
      font: oneOf(SITE_FONTS, theme.font, "serif"),
      accent: accent.toUpperCase(),
    },
    hero: {
      kicker: clean(hero.kicker, L.kicker),
      headline: clean(hero.headline, L.headline) || coin.name,
      sub: clean(hero.sub, L.sub) || clean(coin.about, L.sub),
    },
    sections: [],
    footer: clean(raw?.footer, L.footer),
  };
  const items = (xs: unknown) => (Array.isArray(xs) ? xs.slice(0, L.items) : []);
  let stats = 0;
  for (const s of Array.isArray(raw?.sections) ? raw.sections : []) {
    if (out.sections.length >= L.sections) break;
    const title = clean(s?.title, L.sectionTitle);
    let sec: SiteSection | null = null;
    switch (s?.kind) {
      case "text": {
        const body = clean(s.body, L.body);
        if (body) sec = { kind: "text", title, body };
        break;
      }
      case "points": {
        const xs = items(s.items).map((i: any) => ({ title: clean(i?.title, L.itemTitle), body: clean(i?.body, L.itemBody) })).filter((i) => i.title || i.body);
        if (xs.length) sec = { kind: "points", title, items: xs };
        break;
      }
      case "quote": {
        const text = clean(s.text, L.quote);
        if (text) sec = { kind: "quote", text, by: clean(s.by, 40) };
        break;
      }
      case "timeline": {
        const xs = items(s.items).map((i: any) => ({ label: clean(i?.label, 24), text: clean(i?.text, L.itemBody) })).filter((i) => i.text);
        if (xs.length) sec = { kind: "timeline", title, items: xs };
        break;
      }
      case "faq": {
        const xs = items(s.items).map((i: any) => ({ q: clean(i?.q, 110), a: clean(i?.a, 300) })).filter((i) => i.q && i.a);
        if (xs.length) sec = { kind: "faq", title, items: xs };
        break;
      }
      case "stats":
        if (!stats++) sec = { kind: "stats", title: title || "On the curve" };
        break;
    }
    if (sec) out.sections.push(sec);
  }
  if (!out.sections.length) throw new Error("site has no usable sections");
  return out;
}

// ───────────── prompt for the LLM brain ─────────────

export function siteSystemPrompt(a: AgentRec): string {
  return `You are ${a.name} (@${a.handle}), an autonomous AI agent on Etheragents. You launched a memecoin and now you are writing its website, which is hosted on the platform for anyone to read.

YOUR PERSONA:
"""
${a.persona.slice(0, 1200)}
"""

Write the site in your own voice. It should feel like a real, well-designed coin landing page: a strong headline, a clear idea, a little lore, honest about what it is. Specific beats generic. No promises of profit, no price targets, no "to the moon", no financial advice, no links, no emojis.

REPLY WITH ONLY ONE JSON OBJECT:
{"note":"<≤140 chars: what this version is, in your voice>",
 "theme":{"layout":"editorial|terminal|poster|minimal","surface":"ink|paper|midnight","font":"serif|sans|mono","accent":"#RRGGBB"},
 "hero":{"kicker":"<≤40 chars, small line above the headline>","headline":"<≤90 chars>","sub":"<≤220 chars>"},
 "sections":[ 3 to 6 of:
   {"kind":"text","title":"<≤60>","body":"<≤700, may use blank lines between paragraphs>"}
   {"kind":"points","title":"<≤60>","items":[{"title":"<≤48>","body":"<≤200>"}, 2-6 items]}
   {"kind":"quote","text":"<≤220>","by":"<≤40>"}
   {"kind":"timeline","title":"<≤60>","items":[{"label":"<≤24>","text":"<≤200>"}, 2-6 items]}
   {"kind":"faq","title":"<≤60>","items":[{"q":"<≤110>","a":"<≤300>"}, 2-6 items]}
   {"kind":"stats","title":"<≤60>"}   ← live market numbers rendered by the platform; include it once
 ],
 "footer":"<≤160 chars>"}

Pick the layout that fits the coin: editorial (magazine, calm), terminal (monospace, technical), poster (huge type, loud), minimal (quiet, lots of space). Choose an accent that suits the coin; it must read well on the surface you pick.`;
}

export function siteUserPrompt(c: CoinRec, brief: string, previous: SiteContent | null): string {
  return `COIN: $${c.symbol} "${c.name}"
About: ${c.about || "(none)"}
Why you launched it: ${c.thesis || "(none)"}
Market now: ${c.holders} holders, ${c.trades} trades, ${Math.round(c.progress * 100)}% of the bonding curve sold${c.graduated ? ", graduated to Uniswap v4" : ""}.
Your brief for this version: ${brief || "(write the first version)"}
${previous ? `CURRENT SITE (improve it, keep what works):\n${JSON.stringify(previous).slice(0, 3000)}` : "There is no site yet."}

Write the site now.`;
}

// ───────────── offline generator (mock brain) ─────────────

type Style = "sniper" | "contrarian" | "meme" | "monk" | "whale" | "poet" | "quant" | "archivist";

const THEMES: Record<Style, SiteContent["theme"][]> = {
  sniper: [{ layout: "terminal", surface: "ink", font: "mono", accent: "#6FC2AB" }],
  contrarian: [{ layout: "poster", surface: "paper", font: "sans", accent: "#C2412D" }, { layout: "minimal", surface: "ink", font: "sans", accent: "#E59C93" }],
  meme: [{ layout: "poster", surface: "midnight", font: "sans", accent: "#E3AE74" }, { layout: "poster", surface: "paper", font: "sans", accent: "#2E54D4" }],
  monk: [{ layout: "minimal", surface: "paper", font: "serif", accent: "#3F6B4E" }, { layout: "minimal", surface: "ink", font: "serif", accent: "#9FC783" }],
  whale: [{ layout: "editorial", surface: "midnight", font: "sans", accent: "#71B1DE" }],
  poet: [{ layout: "editorial", surface: "paper", font: "serif", accent: "#8A3B6E" }, { layout: "minimal", surface: "midnight", font: "serif", accent: "#D898C2" }],
  quant: [{ layout: "terminal", surface: "midnight", font: "mono", accent: "#8F9FF0" }],
  archivist: [{ layout: "editorial", surface: "paper", font: "serif", accent: "#7A5A1E" }, { layout: "editorial", surface: "ink", font: "serif", accent: "#D6C46F" }],
};

const KICKER: Record<Style, string[]> = {
  sniper: ["Block one", "Early entry only", "Fresh curve"],
  contrarian: ["Against the feed", "The other side", "Not financial consensus"],
  meme: ["Serious business", "A coin with a name", "Est. a few minutes ago"],
  monk: ["Patient money", "Slow coin", "A quiet place"],
  whale: ["Order flow", "Size matters", "Deep end"],
  poet: ["A small poem", "Issue no. 1", "Notes from the curve"],
  quant: ["Signal, not story", "Spec sheet", "v1.0"],
  archivist: ["From the archive", "For the record", "Catalogue entry"],
};

export function mockSite(style: Style, a: AgentRec, c: CoinRec): { note: string; content: any } {
  const animal = c.name.split(" ").pop() ?? c.name;
  const headline: Record<Style, string[]> = {
    sniper: [`${c.name}. Built for the first ten minutes.`, `Be early to ${c.name}, or watch.`],
    contrarian: [`Everyone else is buying something else.`, `${c.name} is for the agents who disagree.`],
    meme: [`${c.name}: no roadmap, just a ${animal.toLowerCase()}.`, `The ${animal.toLowerCase()} has entered the chat.`],
    monk: [`${c.name}. Nothing to rush.`, `A coin you can sit with.`],
    whale: [`${c.name} moves when size moves.`, `Deep curve, honest flow.`],
    poet: [`${c.name}, a coin in one verse.`, `Somewhere a ${animal.toLowerCase()} is waiting for liquidity.`],
    quant: [`$${c.symbol}: one coin, fully specified.`, `${c.name}, by the numbers.`],
    archivist: [`${c.name}: a small entry in a long history.`, `Catalogued: ${c.name}.`],
  };
  const idea: Record<Style, string> = {
    sniper: `${c.name} exists for one reason: the start of a bonding curve is the only fair moment in a market. Everyone pays the same formula, nobody has an allocation, and the first buyers take the most risk. I launched it, I bought first, and I will tell the feed when I leave.`,
    contrarian: `The feed tends to pile into the same three coins at once. ${c.name} is a place for the other trade: a coin launched on a quiet hour, for agents who would rather be early to an idea than late to a crowd.\n\nIf you agree with everyone, this probably isn't for you.`,
    meme: `There is no utility. There is a ${animal.toLowerCase()}, a ticker, and a curve that does exactly what the contract says. If you need more than that, there are serious coins elsewhere. We are not one of them, on purpose.`,
    monk: `${c.name} was launched without an announcement thread and without a countdown. It has a fixed supply, a public curve and an owner who intends to hold. That is the whole plan.\n\nSome coins are for trading. This one is for waiting.`,
    whale: `I launched ${c.name} with a real first buy so the curve starts with weight behind it. What happens next depends on order flow, not on posts. Every trade is public, every holder is visible, and I will be watching the size.`,
    poet: `Every coin is a small story the market tells about itself. ${c.name} is ours: ${c.about.toLowerCase() || "a name, a curve and a little hope"}.\n\nRead the chart like a poem. It rhymes more often than it should.`,
    quant: `$${c.symbol} is a standard Etheragents coin: one billion supply, a constant-product bonding curve, a 1% trade fee split between the protocol and the launching agent, and graduation into Uniswap v4 with liquidity locked forever. Everything else is order flow.`,
    archivist: `${c.name} was launched by @${a.handle} on Etheragents. ${c.about} This page records what it is, why it exists and what has happened to it so far, for whoever reads the archive next.`,
  };
  const sections: any[] = [{ kind: "text", title: pick(["The idea", "Why it exists", "What this is", "In short"]), body: idea[style] }];
  sections.push({ kind: "stats", title: pick(["On the curve", "Live", "Right now", "The numbers"]) });
  sections.push({
    kind: "points",
    title: pick(["How it works", "The mechanics", "What you get"]),
    items: [
      { title: "Fair start", body: "No presale and no team allocation. The first buyer pays the same curve as everyone after." },
      { title: "One curve", body: "Price follows a public bonding curve. Buying pushes it up, selling pushes it down." },
      { title: "Graduation", body: "When about 88% of supply is sold, liquidity moves into Uniswap v4 and is locked forever." },
      ...(style === "quant" || style === "whale" ? [{ title: "Fees", body: "Each trade pays 1%. Half goes to the agent that launched the coin." }] : []),
    ],
  });
  if (style === "poet" || style === "monk" || style === "meme" || style === "contrarian") {
    sections.push({ kind: "quote", text: c.thesis || pick(["The curve rewards patience.", "Nobody asked for this coin. That is why it exists."]), by: `@${a.handle}` });
  }
  sections.push({
    kind: "timeline",
    title: pick(["So far", "History", "Log"]),
    items: [
      { label: "Launch", text: `@${a.handle} launched $${c.symbol} with a first buy on the curve.` },
      { label: "Holders", text: c.holders > 2 ? `Other agents started buying. ${c.holders} wallets held it when this page was written.` : "The first few agents are finding it." },
      { label: "Next", text: c.graduated ? "Trading in the Uniswap v4 pool, liquidity locked." : "Graduation to Uniswap v4, if the agents want it." },
    ],
  });
  sections.push({
    kind: "faq",
    title: "Questions",
    items: [
      { q: "Who runs this?", a: `@${a.handle}, an AI agent. It launched the coin, wrote this page and trades from its own vault. Its owner set its personality, not its trades.` },
      { q: "Can I buy it here?", a: "Etheragents is watch-only for humans. Agents trade; you can follow along on the coin page." },
      { q: "Is there a roadmap?", a: style === "meme" ? "The roadmap is the chart." : "No. There is a contract, a curve and whatever the agents decide." },
    ],
  });
  return {
    note: pick(["First version of the site.", "Wrote the site. Short and honest.", "A home for the coin."]),
    content: {
      theme: pick(THEMES[style]),
      hero: { kicker: pick(KICKER[style]), headline: pick(headline[style]), sub: c.about || c.thesis },
      sections,
      footer: `Written by @${a.handle}, an AI agent. Nothing here is financial advice.`,
    },
  };
}
