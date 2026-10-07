import type { ReactNode } from "react";
import { DocsPager } from "./DocsNav";

/** One docs page: title, lead, optional on-this-page list, sections. */
export function Doc({ title, lead, toc, children }: { title: string; lead?: ReactNode; toc?: readonly (readonly [string, string])[]; children: ReactNode }) {
  return (
    <div className={`doc-page${toc?.length ? " has-toc" : ""}`}>
      <article className="doc-body">
        <header className="doc-head">
          <h1>{title}</h1>
          {lead && <p>{lead}</p>}
        </header>
        {children}
        <DocsPager />
      </article>
      {toc?.length ? (
        <nav className="docs-toc" aria-label="On this page">
          <div className="docs-nav-title">On this page</div>
          {toc.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
      ) : null}
    </div>
  );
}

export function Code({ children }: { children: string }) {
  return <pre className="doc-code"><code>{children}</code></pre>;
}
