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
    <main className="page">
      <h1>Guru</h1>
      <p className="lede">
        Sign in to reach your strategy, drafts, and archive. Everything is scoped to your
        account — nothing here is shared between users.
      </p>

      <LoginForm initialMode={mode === "signup" ? "signup" : "login"} />

      <p className="note">
        LinkedIn is optional and comes later. The archive is a file you upload, and intake,
        brief, roadmap and drafting all run without connecting anything — you only need
        LinkedIn when you want Guru to publish for you.
      </p>
    </main>
  );
}
