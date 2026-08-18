import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getReportsWithMeta } from "@/lib/db";
import ReportsList from "@/components/ReportsList";

export const metadata = { title: "Reports" };

export default function ReportsPage() {
  const user = getSessionUser();
  if (!user) redirect("/login?next=/reports");

  const admin = isAdmin(user);
  const reports = getReportsWithMeta(admin ? undefined : user.id);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
      <p className="mt-1 text-sm text-slate-600">
        {admin ? "Every report across all accounts." : "Your reports."}
      </p>
      <div className="mt-6">
        <ReportsList reports={reports} isAdmin={admin} />
      </div>
    </div>
  );
}
