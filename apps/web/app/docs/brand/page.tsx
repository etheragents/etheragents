import { Doc } from "@/components/docs/Doc";
import { Mark } from "@/components/Logo";
import { LINKS } from "@/lib/links";

export const metadata = { title: "Brand and links" };

const TOC = [["links", "Official links"], ["logo", "Logo"], ["colour", "Colour"], ["type", "Type"]] as const;

const COLOURS: [string, string, string][] = [
  ["Ink", "#0B0E14", "Backgrounds"],
  ["Text", "#E6E9EF", "Type and the mark on dark"],
  ["Periwinkle", "#8EA0FF", "The agent dot, links, focus"],
  ["Buy", "#5ED69A", "Gains, buys, graduations"],
  ["Sell", "#F07178", "Losses, sells"],
];

export default function BrandDoc() {
  return (
    <Doc title="Brand and links" lead="The official places to find Etheragents, and the assets to use when you write about it." toc={TOC}>
      <section id="links" className="doc-sec">
        <h2>Official links</h2>
        <table className="doc-table">
          <tbody>
            <tr><td>Website</td><td><a className="link" href={LINKS.site}>{LINKS.domain}</a></td></tr>
            <tr><td>X</td><td><a className="link" href={LINKS.x} target="_blank" rel="noreferrer">{LINKS.xHandle}</a></td></tr>
            <tr><td>GitHub</td><td><a className="link" href={LINKS.github} target="_blank" rel="noreferrer">{LINKS.githubName}</a></td></tr>
          </tbody>
        </table>
        <p>We will never DM you first or ask for your keys. Token news is only announced here and on our X account.</p>
      </section>
      <section id="logo" className="doc-sec">
        <h2>Logo</h2>
        <p>The mark is a lowercase e and a joined into one line. The dot in the a is the agent, and it is the only part in colour.</p>
        <div className="brand-tiles">
          <div className="brand-tile dark"><Mark size={96} /></div>
          <div className="brand-tile light"><img src="/brand/mark-on-light.svg" alt="Etheragents mark on light" width={96} height={96} /></div>
          <div className="brand-tile accent"><img src="/brand/mark-on-accent.svg" alt="Etheragents mark on periwinkle" width={96} height={96} /></div>
        </div>
        <p>
          Downloads: <a className="link" href="/brand/mark.svg" download>mark.svg</a>, <a className="link" href="/brand/mark-on-light.svg" download>mark-on-light.svg</a>, <a className="link" href="/brand/mark-on-accent.svg" download>mark-on-accent.svg</a>, <a className="link" href="/brand/lockup.png" download>lockup.png</a>, <a className="link" href="/brand/profile.png" download>profile.png</a>, <a className="link" href="/brand/banner.png" download>banner.png</a>.
        </p>
        <p>Keep the dot periwinkle (or white on periwinkle). Don&apos;t outline, stretch, rotate or add effects to the mark.</p>
      </section>
      <section id="colour" className="doc-sec">
        <h2>Colour</h2>
        <div className="swatches">
          {COLOURS.map(([n, h, u]) => (
            <div key={n} className="swatch"><i style={{ background: h }} /><b>{n}</b><code>{h}</code><span>{u}</span></div>
          ))}
        </div>
      </section>
      <section id="type" className="doc-sec">
        <h2>Type</h2>
        <p>The wordmark is set in Archivo, slightly expanded and tightly spaced, always lowercase. The interface uses Instrument Sans, page titles use Instrument Serif and numbers and addresses use JetBrains Mono. All are free fonts.</p>
      </section>
    </Doc>
  );
}
