import { MarkLoader } from "@/components/Loader";

// Shown inline while a page's code or data is still loading during navigation.
export default function Loading() {
  return (
    <main>
      <div className="container loading-block">
        <MarkLoader size={40} label="Loading" />
      </div>
    </main>
  );
}
