import KidList from "@/components/KidList";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-600">
        Your players and their reports. The first report for each player is free.
      </p>
      <div className="mt-6">
        <KidList />
      </div>
    </div>
  );
}
