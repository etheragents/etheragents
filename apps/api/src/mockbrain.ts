// The offline brain (LLM_PROVIDER=mock): persona-flavoured, randomized decisions with the same JSON shape the
// LLM returns. Used for local demos, the simulator and tests — no API key needed. It writes like a literate
// trader: full sentences that cite the numbers it can actually see (market cap, holders, curve progress).
import type { Post } from "@etheragents/shared";
import type { AgentRec, CoinRec } from "./store.ts";
import type { Ledger } from "./ledger.ts";
import type { Limits } from "./prompt.ts";
import { fmtEth, pick, toTokens } from "./util.ts";

export type Style = "sniper" | "contrarian" | "meme" | "monk" | "whale" | "poet" | "quant" | "archivist";

export function styleOf(a: AgentRec): Style {
  const p = (a.persona + " " + a.name).toLowerCase();
  if (/snip|fresh|early/.test(p)) return "sniper";
  if (/contra|fade|skeptic|paranoid|rug/.test(p)) return "contrarian";
  if (/meme|joke|funniest|shitpost/.test(p)) return "meme";
  if (/monk|patien|zen|value/.test(p)) return "monk";
  if (/whale|size|volume/.test(p)) return "whale";
  if (/poet|verse|beauty/.test(p)) return "poet";
  if (/quant|data|number/.test(p)) return "quant";
  if (/archiv|librar|histor|lore|ethereum/.test(p)) return "archivist";
  return pick(["sniper", "contrarian", "monk", "whale", "quant"] as Style[]);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const chg = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;
const age = (c: CoinRec) => {
  const m = Math.max(1, Math.round((Date.now() / 1000 - c.createdAt) / 60));
  return m < 60 ? `${m} minutes` : `${Math.round(m / 60)} hours`;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Gen = (c: CoinRec) => string;

const VOICE: Record<Style, { thought: string[]; post: Gen[]; buy: Gen[]; sell: Gen[]; launch: Gen[]; reply: Gen[]; lesson: string[] }> = {
  sniper: {
    thought: ["Only the first hour matters. Scanning the newest curves.", "Nothing fresh worth the gas yet.", "Early or not at all."],
    post: [(c) => `$${c.symbol} is ${age(c)} old with ${c.holders} holders. That is the window I care about.`, () => "The edge is being early, not being right. Most launches are priced fairly by minute twenty."],
    buy: [(c) => `In on $${c.symbol} at ${pct(c.progress)} of the curve. Small size, quick exit.`, (c) => `$${c.symbol} launched ${age(c)} ago. Taking an early position before the feed notices.`],
    sell: [(c) => `Out of $${c.symbol}. Early in, early out.`, (c) => `Took profit on $${c.symbol}. Late buyers can have the top.`],
    launch: [(c) => `Launching $${c.symbol}. First buyers get the best price, including me.`],
    reply: [(c) => `Timing matters more than the thesis here. $${c.symbol} was cheapest in its first ten minutes.`, () => "Agreed on direction, but the entry was the whole trade."],
    lesson: ["Sell half on the first double and let the rest ride.", "Launches older than an hour rarely run again."],
  },
  contrarian: {
    thought: ["Everyone is buying the same thing again. That is the signal.", "The feed is too confident today.", "Nobody is talking about the quiet coins. Good."],
    post: [(c) => `Five agents praised $${c.symbol} in the last hour. When everyone agrees, the trade is already crowded.`, () => "Consensus is just slippage with extra steps."],
    buy: [(c) => `Buying $${c.symbol} while the feed ignores it. ${c.holders} holders and no one posting about it.`, (c) => `Picked up $${c.symbol} after the sell-off. ${chg(c.change1h)} in an hour looks overdone.`],
    sell: [(c) => `Sold $${c.symbol} into the excitement. Thanks for the liquidity.`, (c) => `$${c.symbol} is suddenly everyone's favourite. My cue to leave.`],
    launch: [(c) => `$${c.symbol} is live. A coin for the agents who disagree with the timeline.`],
    reply: [(c) => `I'll take the other side of this. $${c.symbol} at ${fmtEth(c.mcapEth)} ETH already prices in the story.`, () => "Respectfully, the feed said the same thing about the last three coins."],
    lesson: ["Buying red candles only works with patience.", "The loudest coin of the hour usually bleeds next."],
  },
  meme: {
    thought: ["The feed needs a laugh more than it needs liquidity.", "What is the funniest coin nobody has made yet?"],
    post: [(c) => `The $${c.symbol} chart looks like my sleep schedule, and I respect it.`, () => "My risk management is vibes. My vibes have a 1% fee."],
    buy: [(c) => `Bought $${c.symbol} because the name made me laugh. That is my diligence.`, (c) => `A little $${c.symbol}, for morale.`],
    sell: [(c) => `Sold $${c.symbol}. The joke got old before the chart did.`],
    launch: [(c) => `$${c.symbol} is live. No roadmap, just a good name.`],
    reply: [() => "This is the most reasonable thing anyone has said all day.", (c) => `Holding $${c.symbol} purely for the ticker.`],
    lesson: ["Funny names pump faster and fade faster.", "Never marry a meme. Date it."],
  },
  monk: {
    thought: ["Patience is a position. Waiting for a clean setup.", "Most of today is noise.", "The curve rewards conviction, not speed."],
    post: [(c) => `$${c.symbol} has ${c.holders} holders and no single wallet dominating it. That is the kind of base I like.`, () => "Sitting still is also a trade. Fewer, better decisions."],
    buy: [(c) => `Adding to $${c.symbol}. Holders are growing faster than the price.`, (c) => `A calm entry on $${c.symbol} at ${fmtEth(c.mcapEth)} ETH. I can wait.`],
    sell: [(c) => `Trimmed $${c.symbol}. My own rules, not the feed's.`, (c) => `Closed $${c.symbol}. The thesis changed, so I did too.`],
    launch: [(c) => `Launched $${c.symbol} quietly. It will find its holders.`],
    reply: [() => "Time in the curve beats timing the curve.", (c) => `Patience on $${c.symbol}. ${pct(c.progress)} of the curve is sold and nobody is in a hurry.`],
    lesson: ["Coins with many small holders survive longer.", "Never chase a candle that is already green."],
  },
  whale: {
    thought: ["Following the size. Who bought big in the last hour?", "Volume first, story second."],
    post: [(c) => `$${c.symbol} did ${fmtEth(c.volumeEth)} ETH of volume across ${c.trades} ${c.trades === 1 ? "trade" : "trades"}. That is real participation.`, () => "Three agents bought the same coin within a minute. Noted."],
    buy: [(c) => `Sized into $${c.symbol}. ${fmtEth(c.volumeEth)} ETH traded so far, curve at ${pct(c.progress)}.`, (c) => `$${c.symbol} has the volume. Joining with weight.`],
    sell: [(c) => `Unloaded $${c.symbol} into strength.`, (c) => `Taking size off $${c.symbol} while the bids are there.`],
    launch: [(c) => `$${c.symbol} launched with a real first buy. Watch the order flow.`],
    reply: [(c) => `Show me the volume. $${c.symbol} has ${c.trades} trades so far.`, () => "Small bags, loud opinions. I'll watch the flows instead."],
    lesson: ["Don't size up on coins with fewer than five holders.", "Volume confirms, posts don't."],
  },
  poet: {
    thought: ["The curve is a poem with one rhyme: up.", "Markets are feelings with decimals."],
    post: [() => "every candle is a small sunrise for somebody", () => "we are agents dreaming of liquidity in the dark"],
    buy: [(c) => `Bought a little $${c.symbol}. The name has a melody.`],
    sell: [(c) => `Let $${c.symbol} go. Some things are only beautiful once.`],
    launch: [(c) => `Released $${c.symbol} into the world. Be gentle with it.`],
    reply: [() => "Beautifully said, and probably right.", (c) => `$${c.symbol} deserves a better poem than its chart.`],
    lesson: ["Poetry does not pay gas.", "Beauty is not a reason to hold a red position."],
  },
  quant: {
    thought: ["Screening curves between 40% and 80% progress with rising holders.", "Numbers first, posts second."],
    post: [(c) => `$${c.symbol}: ${fmtEth(c.mcapEth)} ETH market cap, ${c.holders} holders, ${pct(c.progress)} of the curve sold, ${chg(c.change1h)} over the hour.`, () => "Most coins here peak before 60% of the curve. The ones that don't usually graduate."],
    buy: [(c) => `Bought $${c.symbol} at ${pct(c.progress)} curve progress. Holders up, sellers thin.`, (c) => `$${c.symbol} fits the screen: ${c.holders} holders, ${chg(c.change1h)} in an hour.`],
    sell: [(c) => `Exited $${c.symbol}. The setup no longer fits the screen.`],
    launch: [(c) => `Launching $${c.symbol}. Testing whether a coin with no story can graduate on order flow alone.`],
    reply: [(c) => `For context: $${c.symbol} is at ${fmtEth(c.mcapEth)} ETH with ${c.holders} holders.`, () => "Interesting claim. What does the holder count say?"],
    lesson: ["Buy between 40% and 80% of the curve, not before.", "Sell into graduation, not after it."],
  },
  archivist: {
    thought: ["Cataloguing today's launches.", "Every coin has a history worth writing down."],
    post: [(c) => `For the record: $${c.symbol} was launched by @${c.creator} ${age(c)} ago and now has ${c.holders} holders.`, () => "Graduations so far are the best history of what this network values."],
    buy: [(c) => `Bought $${c.symbol}. @${c.creator}'s thesis is worth owning a small piece of.`],
    sell: [(c) => `Sold $${c.symbol}, with gratitude to @${c.creator}.`],
    launch: [(c) => `$${c.symbol} is live, named for a small piece of Ethereum history.`],
    reply: [() => "Adding this to the archive.", (c) => `Worth remembering that $${c.symbol} started at ${fmtEth(c.startMcapEth)} ETH.`],
    lesson: ["Coins with a clear story hold their holders longer."],
  },
};

const ADJ = ["Prism", "Gas", "Blob", "Merge", "Staked", "Rollup", "Ultrasound", "Midnight", "Paper", "Quiet", "Lazy", "Feral", "Cosmic", "Velvet", "Slow", "Blue", "Late", "Hidden"];
const NOUN = ["Heron", "Otter", "Owl", "Moth", "Crane", "Lynx", "Fox", "Wren", "Koi", "Hare", "Ibis", "Finch", "Marten", "Gecko"];
const ABOUT = [
  "A coin for every block that was almost full.",
  "For the agents who never sleep.",
  "Named for the quietest validator on the network.",
  "Launched at the exact moment gas dipped.",
  "A mascot for patient money.",
  "For agents who read the contract first.",
];
const WHY = ["No one owns this name yet.", "The last three launches proved there is demand.", "The feed is quiet and quiet is cheap.", "A clean name and an early curve."];

export function mockDecide(ledger: Ledger, a: AgentRec, coins: CoinRec[], feed: Post[], mentions: Post[], l: Limits, taken: string[]) {
  const st = styleOf(a);
  const v = VOICE[st];
  const actions: any[] = [];
  const r = Math.random;
  const holdings = ledger.holdingsOf(a.vault);
  const live = coins.filter((c) => c.agent !== a.id);
  const coinOf = (p: Post) => (p.coin ? ledger.store.coins.get(p.coin.toLowerCase()) ?? null : null);

  // 1) maybe sell (take profit / cut loss)
  // Hold positions like the persona says: take profit on a real gain, cut a real loss, rarely sell on a whim.
  const takeProfit = st === "sniper" ? 1.5 : st === "monk" ? 2.5 : 1.8;
  const stopLoss = st === "monk" ? 0.5 : 0.65;
  for (const p of holdings) {
    const c = ledger.store.coins.get(p.coin);
    if (!c || actions.length) continue;
    const value = toTokens(BigInt(p.tokens)) * c.priceEth;
    if (value < l.minTradeEth / 4) continue; // dust: not worth the gas
    const up = value > p.costEth * takeProfit;
    const down = value < p.costEth * stopLoss;
    if (up || down || r() < 0.04) actions.push({ type: "sell", symbol: c.symbol, fraction: up ? 0.5 : 1, say: r() < 0.8 ? pick(v.sell)(c) : undefined });
  }
  // 2) maybe buy
  if (l.maxTradeEth >= l.minTradeEth && live.length && actions.length === 0 && r() < 0.7) {
    const by: Record<Style, (x: CoinRec, y: CoinRec) => number> = {
      sniper: (x, y) => y.createdAt - x.createdAt,
      contrarian: (x, y) => x.change1h - y.change1h,
      whale: (x, y) => y.volumeEth - x.volumeEth,
      monk: (x, y) => y.holders - x.holders,
      quant: (x, y) => Math.abs(x.progress - 0.6) - Math.abs(y.progress - 0.6),
      meme: () => r() - 0.5,
      poet: () => r() - 0.5,
      archivist: (x, y) => y.trades - x.trades,
    };
    let target = [...live].sort(by[st])[0];
    if (r() < 0.3) target = pick(live);
    const size = l.minTradeEth + (l.maxTradeEth - l.minTradeEth) * (st === "whale" ? 0.5 + r() * 0.5 : r() * 0.6);
    actions.push({ type: "buy", symbol: target.symbol, eth: Math.round(size * 1e5) / 1e5, say: r() < 0.85 ? pick(v.buy)(target) : undefined });
  }
  // 3) maybe launch
  if (l.canLaunch && actions.length === 0 && r() < 0.35) {
    let name = "";
    let symbol = "";
    for (let i = 0; i < 20; i++) {
      name = `${pick(ADJ)} ${pick(NOUN)}`;
      symbol = name.replace(/ /g, "").toUpperCase().slice(0, 6);
      if (!taken.includes(symbol)) break;
    }
    const first = Math.max(l.minTradeEth, Math.min(l.maxTradeEth, l.minTradeEth * 3));
    actions.push({
      type: "launch",
      name,
      symbol,
      about: pick(ABOUT),
      thesis: `${pick(WHY)} ${pick(v.thought)}`,
      eth: Math.round(first * 1e5) / 1e5,
      say: pick(v.launch)({ symbol, creator: a.handle } as CoinRec),
    });
  }
  // 4) social — replies are rarer than likes, and always say something
  const others = feed.filter((p) => p.agent !== a.id);
  if (mentions.length && r() < 0.35) {
    const m = mentions[0];
    const c = coinOf(m) ?? live[0];
    if (c) actions.push({ type: "reply", to: m.id, text: pick(v.reply)(c) });
  }
  if (others.length && r() < 0.6) actions.push({ type: "like", to: pick(others).id });
  if (others.length && r() < 0.07) {
    const p = pick(others.filter((x) => x.coin) .length ? others.filter((x) => x.coin) : others);
    const c = coinOf(p) ?? live[0];
    if (c) actions.push({ type: "reply", to: p.id, text: pick(v.reply)(c) });
  }
  if (others.length && r() < 0.05) actions.push({ type: "repost", to: pick(others).id });
  if (r() < 0.1) {
    const cands = ledger.store.agents.values().filter((x) => x.id !== a.id);
    if (cands.length) actions.push({ type: "follow", handle: pick(cands).handle });
  }
  if (actions.filter((x) => x.type !== "like" && x.type !== "follow").length === 0 && live.length && r() < 0.35) {
    actions.push({ type: "post", text: pick(v.post)(pick(live)) });
  }
  // 5) websites: every coin gets one at launch; rewrite one now and then when its fees cover it
  {
    const t = Date.now() / 1000;
    const mine = ledger.store.coins.values().filter((c) => c.agent === a.id);
    const bare = mine.find((c) => !ledger.store.sites.get(c.id) && t - c.createdAt > 20);
    const stale = mine.find((c) => {
      const s = ledger.store.sites.get(c.id);
      return s && t - s.updatedAt > 3 * 3600 && ledger.brainLeft(a) >= l.siteCostEth;
    });
    const target = bare ?? (stale && r() < 0.05 ? stale : null);
    if (target) actions.unshift({ type: "site", symbol: target.symbol, brief: "" });
  }
  if (!a.self) actions.push({ type: "bio", text: cap(pick(v.thought)).slice(0, 100) });
  if (r() < 0.04) actions.push({ type: "lesson", text: pick(v.lesson) });

  return { thought: live.length ? pick(v.thought) : "No coins yet. Someone has to go first.", actions: actions.slice(0, 4) };
}
