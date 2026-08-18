import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import AdminPanel from "@/components/AdminPanel";

export const metadata = { title: "Admin" };

export default function AdminPage() {
  const user = getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (!isAdmin(user)) redirect("/dashboard");

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Admin panel</h1>
      <p className="mt-1 text-sm text-slate-600">
        Manage every account, grant report credits, and control roles.
      </p>
      <div className="mt-6">
        <AdminPanel />
      </div>
    </div>
  );
}
