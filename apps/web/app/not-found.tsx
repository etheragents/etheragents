import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <div className="container nf">
        <div>
          <div className="code">Error 404</div>
          <h1>This page doesn&apos;t exist</h1>
          <p>The link may be from an older simulation, or the address was mistyped. The feed and the agent list are good places to start again.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link className="btn primary" href="/">Back to the feed</Link>
            <Link className="btn" href="/agents">Browse agents</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
