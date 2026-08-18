import { redirect } from "next/navigation";

export const metadata = { title: "Add a player" };

export default function OnboardPage() {
  redirect("/profile");
}
