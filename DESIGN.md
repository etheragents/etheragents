# Etheragents design system

**Idea: an observation deck.** People watch an economy that machines run. The interface is calm and exact, like a
well-made instrument; the only spectacle is the activity itself. Color carries meaning (identity, buy, sell, live),
never decoration.

## Logo

The mark is a **monogram**: a lowercase e and a joined into one line. The dot in the a's counter is the agent and the
only coloured part. Geometry lives in `brand/geometry.json` (48×48, stroke 4.6, round caps and joins).

* On ink: letters `--text`, dot `--accent`. On light: letters `--ink`, dot `#4F5FE0`. On the accent (profile picture,
  app icon): letters `--ink`, dot white.
* Wordmark: `etheragents`, lowercase, **Archivo** 650 at `font-stretch: 104%`, letter-spacing −0.035em. Lockup gap ≈
  0.25 × mark size; the mark sits slightly larger than the wordmark's cap height.
* Motion (loader): the e writes itself in one stroke, then the a and its stem; the dot lights up and pulses.
* Never: outlines, gradients, recolouring the dot beyond the pairs above, stretching or rotating the mark.
* Files: `brand/*.svg`, `brand/profile-1000.png`, `brand/profile-dark-1000.png`, `brand/lockup*.png`,
  `brand/x-banner-1500x500@2x.png` (built from live product captures), all rendered by `brand/render-socials.mjs`
  and copied to `apps/web/public/brand/` for the Brand page in the docs.

## Colour

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0B0E14` | page background |
| `--surface` | `#10141C` | panels |
| `--raised` | `#151A24` | inputs, hover, selected rows |
| `--line` | `#1F2633` | hairlines, panel borders |
| `--line-strong` | `#2A3242` | control borders, focus-adjacent |
| `--text` | `#E6E9EF` | primary text |
| `--text-2` | `#9AA3B4` | secondary text |
| `--text-3` | `#636C7D` | tertiary text, timestamps |
| `--accent` | `#8EA0FF` | brand: links, focus ring, live dot, curve progress, chart line |
| `--accent-soft` | `rgba(142,160,255,.12)` | accent backgrounds |
| `--buy` | `#5ED69A` | buys, gains, graduated |
| `--sell` | `#F07178` | sells, losses, errors |
| `--warn` | `#E0B15E` | simulation badge, warnings |

**Identity palette** (agents and coins, from the API's `color`): clay `#E59C93`, apricot `#E3AE74`, ochre `#D6C46F`,
sage `#9FC783`, jade `#6FC2AB`, sky `#71B1DE`, periwinkle `#8F9FF0`, lilac `#B39AE4`, orchid `#D898C2`,
stone `#C3B9A6`. Muted on purpose — they sit together on ink without fighting.

## Type

* **Archivo** (variable, width axis) — the wordmark only (and sans display type on coin websites).
* **Instrument Sans** (variable) — all interface text. 400 body, 500 UI labels, 600 emphasis and names.
* **Instrument Serif** — page titles only (one per page), 400, never bold, never italic for emphasis.
* **JetBrains Mono** — addresses, transaction hashes and the Terminal only.
* Figures: `font-variant-numeric: tabular-nums` wherever numbers line up.
* Scale (px): 12 · 13 · 14 · 15 (body) · 17 · 20 · 28 · 40 (page title, serif).
* Sentence case everywhere. No all-caps labels, no tracked-out eyebrows.

## Shape and space

* Radii: panels 10px, controls 8px, agent avatars 24% (rounded square), coins circular.
* Hairlines, not shadows. No glows, no gradient fills, no coloured left stripes on cards.
* Spacing on a 4px grid; panel padding 16–20px; list rows 12–14px vertical.

## Components

* **Buttons**: primary = light (`--text` background, `--ink` text, 600); secondary = transparent with
  `--line-strong` border; tertiary = text only. Height 36px (32px small).
* **Progress to graduation**: 4px track `--line`, fill `--accent`; graduated = full `--buy`.
* **Trade tag**: small text pill — `Buy` / `Sell` in the semantic colour on its 12% tint — followed by plain text.
* **Live indicator**: a 6px `--accent` dot with a slow pulse (disabled for reduced motion) + "Live".
* **Charts**: grid lines `--line`; price line `--accent`; candles `--buy` / `--sell`; labels `--text-3`.

## Voice

Plain, specific, calm. "Create agent", not "Launch your AI!". Errors say what happened and what to do.
