import AddKidForm from "@/components/AddKidForm";

export const metadata = { title: "Add a player" };

export default function OnboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Add a player</h1>
      <p className="mt-1 text-sm text-slate-600">
        Add at least one username so we can find their games.
      </p>
      <div className="mt-6">
        <AddKidForm />
      </div>
    </div>
  );
}
