// Re-mounted on every navigation: one quiet fade-in for the page content (header and footer stay still).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
