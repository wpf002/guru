import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../lib/api";
import { setupProgress } from "../lib/progress";

/**
 * Signed out this is the pitch; signed in it is a router — into setup if it is
 * unfinished, otherwise into the strategy, which is where the work starts.
 */
export default async function Home() {
  const user = await currentUser();

  // The landing page stays readable signed out — it explains what this is
  // before asking anyone to create an account.
  if (!user) {
    return (
      <main className="page centered">
        <h1>Guru</h1>
        <p className="lede">
          A go-to-market strategist for LinkedIn. It learns your niche, your network and
          how you write, then proposes the strategy and the posts that execute it.
        </p>
        <p>
          <Link className="button" href="/login?mode=signup">
            Create an account
          </Link>{" "}
          <Link href="/login">or sign in</Link>
        </p>
        <p className="note">
          No automated connection requests or DMs — there is no compliant API for either.
          Guru drafts the message; you press send.
        </p>
      </main>
    );
  }

  // Setup is a flow, so the signed-in home is either that flow or the app.
  const { current } = await setupProgress();
  if (current) redirect(current.href);

  redirect("/strategy");
}
