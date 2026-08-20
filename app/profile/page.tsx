import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import ProfileView from "@/components/ProfileView";
import PageHeader from "@/components/PageHeader";

export const metadata = { title: "Profile" };

export default function ProfilePage() {
  const user = getSessionUser();
  if (!user) redirect("/login?next=/profile");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Manage your players, link their online games, and set what to focus on."
      />
      <ProfileView />
    </div>
  );
}
