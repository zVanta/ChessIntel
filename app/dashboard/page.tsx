import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import KidList from "@/components/KidList";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const user = getSessionUser();
  if (!user) redirect("/login?next=/dashboard");

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-600">
        Your players and their reports. Every account starts with one free report credit.
      </p>
      <div className="mt-6">
        <KidList />
      </div>
    </div>
  );
}
