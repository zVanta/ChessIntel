import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import KidList from "@/components/KidList";
import PageHeader from "@/components/PageHeader";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const user = getSessionUser();
  if (!user) redirect("/login?next=/dashboard");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Your players and their reports. Every account starts with one free report credit."
      />
      <KidList />
    </div>
  );
}
