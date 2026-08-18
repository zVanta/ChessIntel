"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }
  return (
    <button onClick={logout} className="text-sm font-medium text-slate-600 hover:text-slate-900">
      Log out
    </button>
  );
}
