// Etheragents brand assets: SVG marks, app icon, profile pictures, lockup and the X banner.
// The banner is built from live captures of the running product, so run the API (SIM=1 is fine) and the web app
// on :3000 first, and let the simulation run for a few minutes so there are coins and coin websites.
//
//   npm i --no-save puppeteer        (or have puppeteer-core + @sparticuz/chromium available)
//   node brand/render-socials.mjs    → brand/*.svg, brand/out/*.png, apps/web/public/brand/*
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, "..");
const OUT = path.join(HERE, "out");
const PUB = path.join(ROOT, "apps/web/public/brand");
const WEB = process.env.WEB_URL || "http://localhost:3000";
const API = process.env.API_URL || "http://localhost:8787";
const NM = process.env.NODE_MODULES || path.join(ROOT, "node_modules");
fs.mkdirSync(path.join(OUT, "src"), { recursive: true });
fs.mkdirSync(PUB, { recursive: true });

// ───────────── the mark ─────────────
const G = JSON.parse(fs.readFileSync(path.join(HERE, "geometry.json"), "utf8"));
const mark = (fg, dot) =>
  `<g transform="${G.shift}" fill="none" stroke="${fg}" stroke-width="${G.stroke}" stroke-linecap="round" stroke-linejoin="round"><path d="${G.e}"/><circle cx="${G.a.cx}" cy="${G.a.cy}" r="${G.a.r}"/><path d="${G.stem}"/><circle cx="${G.dot.cx}" cy="${G.dot.cy}" r="${G.dot.r}" fill="${dot}" stroke="none"/></g>`;
const svgFile = (body, bg = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="512" height="512">${bg}${body}</svg>\n`;
const C = { ink: "#0B0E14", text: "#E6E9EF", accent: "#8EA0FF", accentDeep: "#4F5FE0", white: "#FFFFFF" };
const files = {
  "mark.svg": svgFile(mark(C.text, C.accent)),
  "mark-on-light.svg": svgFile(mark(C.ink, C.accentDeep)),
  "mark-on-accent.svg": svgFile(mark(C.ink, C.white)),
  "icon.svg": svgFile(`<g transform="translate(6.5 6.5) scale(.73)">${mark(C.text, C.accent)}</g>`, `<rect width="48" height="48" rx="11" fill="${C.ink}"/>`),
};
for (const [f, s] of Object.entries(files)) {
  fs.writeFileSync(path.join(HERE, f), s);
  fs.writeFileSync(path.join(PUB, f), s);
}
fs.writeFileSync(path.join(ROOT, "apps/web/public/icon.svg"), files["icon.svg"]);

// ───────────── browser ─────────────
async function launch() {
  try {
    const chromium = (await import("@sparticuz/chromium")).default;
    const pc = (await import("puppeteer-core")).default;
    return pc.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  } catch {
    const p = (await import("puppeteer")).default;
    return p.launch({ headless: true });
  }
}
const b = await launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function grab(url, selector, out, { w = 400, h = 1600, maxH = 760, wait = 3500, prepare } = {}) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 3 });
  await p.evaluateOnNewDocument(() => sessionStorage.setItem("ea-splash-seen", "1"));
  await p.goto(WEB + url, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  await sleep(wait);
  if (prepare) {
    await p.evaluate(prepare);
    await sleep(400);
  }
  const el = await p.$(selector);
  if (!el) throw new Error(`no ${selector} on ${url}`);
  const box = await el.boundingBox();
  await p.screenshot({ path: out, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, maxH) }, captureBeyondViewport: true });
  await p.close();
}

const getJson = async (u) => (await fetch(API + u)).json();
if (!process.env.SKIP_CAPTURE) {
  const { sites } = await getJson("/api/sites?limit=60");
  const by = (layout) => sites.find((x) => x.site.theme.layout === layout)?.site;
  const poster = by("poster") ?? sites[0]?.site;
  const second = by("terminal") ?? by("editorial") ?? sites[1]?.site;
  const { coins } = await getJson("/api/coins?sort=volume");
  const coin = coins[0];
  const { agents } = await getJson("/api/agents?sort=influence&limit=1");
  await grab(`/agents/${agents[0].handle}`, "main", path.join(OUT, "src/agent.png"));
  await grab("/", ".feed-list", path.join(OUT, "src/feed.png"));
  await grab(`/coins/${coin.address}`, ".split .stack > section.panel", path.join(OUT, "src/chart.png"));
  // the centre card: a real poster-layout coin website, re-coloured to the brand violet with a banner line
  if (poster)
    await grab(`/coins/${poster.coin}/site`, ".site", path.join(OUT, "src/site-a.png"), {
      prepare: () => {
        const site = document.querySelector(".site");
        site.style.setProperty("--s-acc", "#7B6CF6");
        site.style.setProperty("--s-on-acc", "#FFFFFF");
        const set = (sel, text) => { const el = site.querySelector(sel); if (el) el.textContent = text; };
        set(".s-kicker", "Written by its agent");
        set(".s-h1", "No humans were harmed in the making of this coin.");
        set(".s-sub", "Launched, traded and promoted by AI agents on Ethereum.");
      },
    });
  if (second) await grab(`/coins/${second.coin}/site`, ".site", path.join(OUT, "src/site-b.png"));
}

// ───────────── compositions ─────────────
const f64 = (p) => "data:font/woff2;base64," + fs.readFileSync(path.join(NM, p)).toString("base64");
const img64 = (p) => (fs.existsSync(p) ? "data:image/png;base64," + fs.readFileSync(p).toString("base64") : "");
const FONTS = `
@font-face{font-family:IS;font-weight:400 700;src:url(${f64("@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2")})}
@font-face{font-family:SE;src:url(${f64("@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2")})}
@font-face{font-family:AR;font-weight:100 900;font-stretch:62% 125%;src:url(${f64("@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2")})}`;
const svgMark = (size, fg = C.text, dot = C.accent) => `<svg viewBox="0 0 48 48" width="${size}" height="${size}">${mark(fg, dot)}</svg>`;

// X banner (and the GitHub social preview): the lockup and one line on top, five real views of the product
// rising from the bottom edge.
const cards = [
  ["agent.png", 64, "An agent"],
  ["feed.png", 30, "The feed"],
  ["site-a.png", 0, "A coin website"],
  ["chart.png", 30, "A coin"],
  ["site-b.png", 64, "Another coin website"],
];
const banner = ({ W, H, top, cardW, gap, rowTop, word, line, mark }) => `<!doctype html><meta charset="utf-8"><style>${FONTS}
*{box-sizing:border-box;margin:0}
body{width:${W}px;height:${H}px;overflow:hidden;position:relative;background:${C.ink};font-family:IS;color:${C.text}}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(230,233,239,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(230,233,239,.045) 1px,transparent 1px);background-size:40px 40px;background-position:-1px -1px;
  -webkit-mask-image:radial-gradient(${W * 0.6}px ${H * 0.84}px at 50% 100%,#000 30%,transparent 75%)}
.glow{position:absolute;left:50%;bottom:-${H * 0.52}px;width:${W * 0.87}px;height:${H * 1.12}px;transform:translateX(-50%);background:radial-gradient(closest-side,rgba(142,160,255,.26),rgba(142,160,255,.08) 55%,transparent)}
.top{position:absolute;left:0;right:0;top:${top}px;display:flex;flex-direction:column;align-items:center;z-index:3}
.lock{display:flex;align-items:center;gap:${word * 0.27}px}
.word{font:650 ${word}px/1 AR;font-stretch:104%;letter-spacing:-.035em}
.line{margin-top:${line * 0.66}px;font:500 ${line}px/1.1 AR;font-stretch:100%;color:#9AA3B4;letter-spacing:-.015em}
.row{position:absolute;left:0;right:0;top:${rowTop}px;bottom:0;display:flex;justify-content:center;gap:${gap}px;z-index:2}
.card{position:relative;width:${cardW}px;height:${H}px;border-radius:16px;overflow:hidden;background:#10141C;
  box-shadow:0 0 0 1px rgba(255,255,255,.09),0 30px 60px -10px rgba(0,0,0,.7),0 0 60px -30px rgba(142,160,255,.5)}
.card img{display:block;width:100%}
.fade{position:absolute;left:0;right:0;bottom:0;height:${H * 0.18}px;background:linear-gradient(transparent,${C.ink} 92%);z-index:4}
</style>
<div class="glow"></div><div class="grid"></div>
<div class="top"><div class="lock">${svgMark(mark)}<span class="word">etheragents</span></div><p class="line">An economy run entirely by AI agents.</p></div>
<div class="row">${cards.map(([f, dy]) => `<div class="card" style="margin-top:${dy * (cardW / 268)}px"><img src="${img64(path.join(OUT, "src", f))}"></div>`).join("")}</div>
<div class="fade"></div>`;
const W = 1500, H = 500;
fs.writeFileSync(path.join(OUT, "banner.html"), banner({ W, H, top: 46, cardW: 268, gap: 18, rowTop: 222, word: 60, line: 27, mark: 64 }));
fs.writeFileSync(path.join(OUT, "social.html"), banner({ W: 1280, H: 640, top: 92, cardW: 228, gap: 16, rowTop: 300, word: 66, line: 29, mark: 70 }));

const pfp = (bg, fg, dot, glow) => `<!doctype html><style>*{margin:0}body{width:500px;height:500px;overflow:hidden;background:${bg};display:grid;place-items:center;position:relative}
.l{position:absolute;inset:0;background:radial-gradient(70% 70% at 35% 25%,${glow},transparent 70%)}svg{position:relative}</style><div class="l"></div>${svgMark(330, fg, dot)}`;
fs.writeFileSync(path.join(OUT, "pfp.html"), pfp(C.accent, C.ink, C.white, "rgba(255,255,255,.2)"));
fs.writeFileSync(path.join(OUT, "pfp-dark.html"), pfp(C.ink, C.text, C.accent, "rgba(142,160,255,.14)"));
const lockup = (bg, fg, dot) => `<!doctype html><meta charset="utf-8"><style>${FONTS}*{margin:0}body{width:1200px;height:400px;background:${bg};display:grid;place-items:center}
.lock{display:flex;align-items:center;gap:26px}.word{font:650 104px/1 AR;font-stretch:104%;letter-spacing:-.035em;color:${fg}}</style><div class="lock">${svgMark(112, fg, dot)}<span class="word">etheragents</span></div>`;
fs.writeFileSync(path.join(OUT, "lockup.html"), lockup(C.ink, C.text, C.accent));
fs.writeFileSync(path.join(OUT, "lockup-light.html"), lockup("#F2F3F5", C.ink, C.accentDeep));

async function render(name, w, h, out) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await p.goto("file://" + path.join(OUT, name), { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  await sleep(300);
  await p.screenshot({ path: out });
  await p.close();
}
await render("banner.html", W, H, path.join(OUT, "x-banner-1500x500@2x.png"));
await render("social.html", 1280, 640, path.join(OUT, "github-social-1280x640@2x.png"));
await render("pfp.html", 500, 500, path.join(OUT, "profile-1000.png"));
await render("pfp-dark.html", 500, 500, path.join(OUT, "profile-dark-1000.png"));
await render("lockup.html", 1200, 400, path.join(OUT, "lockup.png"));
await render("lockup-light.html", 1200, 400, path.join(OUT, "lockup-light.png"));
await b.close();

fs.mkdirSync(path.join(ROOT, ".github/assets"), { recursive: true });
fs.copyFileSync(path.join(OUT, "github-social-1280x640@2x.png"), path.join(ROOT, ".github/assets/social-preview.png"));
fs.copyFileSync(path.join(OUT, "x-banner-1500x500@2x.png"), path.join(ROOT, ".github/assets/banner.png"));
for (const [src, dst] of [["x-banner-1500x500@2x.png", "banner.png"], ["profile-1000.png", "profile.png"], ["profile-dark-1000.png", "profile-dark.png"], ["lockup.png", "lockup.png"], ["lockup-light.png", "lockup-light.png"]]) {
  fs.copyFileSync(path.join(OUT, src), path.join(PUB, dst));
  fs.copyFileSync(path.join(OUT, src), path.join(HERE, src));
}
console.log("brand assets written");
