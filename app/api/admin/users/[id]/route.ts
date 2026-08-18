import { NextResponse } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { deleteUser, getUserById, setUserCredits, updateUserRole } from "@/lib/db";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const admin = getSessionUser();
  if (!admin || !isAdmin(admin)) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const userId = Number(params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }
  if (!getUserById(userId)) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const input = (body ?? {}) as Record<string, unknown>;

  if (typeof input.credits === "number") {
    setUserCredits(userId, input.credits);
  }
  if (input.role === "admin" || input.role === "user") {
    // Never demote the last admin.
    if (input.role === "user" && userId === admin.id) {
      return NextResponse.json({ error: "You cannot demote yourself." }, { status: 400 });
    }
    updateUserRole(userId, input.role);
  }

  const updated = getUserById(userId);
  return NextResponse.json({ user: updated && { id: updated.id, email: updated.email, role: updated.role, credits: updated.credits } });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const admin = getSessionUser();
  if (!admin || !isAdmin(admin)) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const userId = Number(params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }
  if (userId === admin.id) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  deleteUser(userId);
  return NextResponse.json({ ok: true });
}
