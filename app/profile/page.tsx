import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import ProfileView from "@/components/ProfileView";

export const metadata = { title: "Profile" };

export default function ProfilePage() {
  const user = getSessionUser();
  if (!user) redirect("/login?next=/profile");

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Edit profile</h1>
      <p className="mt-1 text-sm text-slate-600">
        Manage your players, link their online games, and set what to focus on.
      </p>
      <div className="mt-6">
        <ProfileView />
      </div>
    </div>
  );
}
