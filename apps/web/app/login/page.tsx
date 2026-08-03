import { redirect } from "next/navigation";
import { currentUser } from "../../lib/api";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  // Already signed in — sending them to a login form would be a dead end.
  if (await currentUser()) redirect("/");

  const { mode } = await searchParams;

  return (
    <main className="page centered">
      <h1>Guru</h1>
      <p className="lede">Your strategy, drafts and archive.</p>

      <LoginForm initialMode={mode === "signup" ? "signup" : "login"} />

      <p className="note">
        LinkedIn is optional. You only need it to publish.
      </p>
    </main>
  );
}
