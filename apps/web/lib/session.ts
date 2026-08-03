import { redirect } from "next/navigation";
import { currentUser, type SessionUser } from "./api";

/**
 * The gate every signed-in page starts with.
 *
 * A page that forgets to call this renders an empty shell rather than someone
 * else's data — the API refuses anonymous requests — but the shell is confusing,
 * so the redirect is what makes "signed out" legible.
 */
export async function requireSession(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
