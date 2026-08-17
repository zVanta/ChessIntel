import { Suspense } from "react";
import ProgressView from "@/components/ProgressView";

export const metadata = { title: "Progress" };

export default function ProgressPage({
  searchParams,
}: {
  searchParams: { kid?: string };
}) {
  const kidId = searchParams.kid ? Number(searchParams.kid) : null;
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Progress</h1>
      <p className="mt-1 text-sm text-slate-600">
        Report history and whether each drill &quot;held&quot; in later games.
      </p>
      <div className="mt-6">
        <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
          <ProgressView kidId={kidId} />
        </Suspense>
      </div>
    </div>
  );
}
