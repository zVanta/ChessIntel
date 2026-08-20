import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import ProgressView from "@/components/ProgressView";
import PageHeader from "@/components/PageHeader";

export const metadata = { title: "Progress" };

export default function ProgressPage({
  searchParams,
}: {
  searchParams: { kid?: string };
}) {
  const user = getSessionUser();
  if (!user) redirect("/login?next=/progress");
  const kidId = searchParams.kid ? Number(searchParams.kid) : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Progress"
        description="Report history and whether each drill held in later games."
      />
      <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
        <ProgressView kidId={kidId} />
      </Suspense>
    </div>
  );
}
