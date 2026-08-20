import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getReportsWithMeta } from "@/lib/db";
import ReportsList from "@/components/ReportsList";
import PageHeader from "@/components/PageHeader";

export const metadata = { title: "Reports" };

export default function ReportsPage() {
  const user = getSessionUser();
  if (!user) redirect("/login?next=/reports");

  const admin = isAdmin(user);
  const reports = getReportsWithMeta(admin ? undefined : user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={admin ? "Every report across all accounts." : "Your reports."}
      />
      <ReportsList reports={reports} isAdmin={admin} />
    </div>
  );
}
