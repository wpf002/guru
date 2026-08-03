import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../lib/api";
import { setupProgress } from "../lib/progress";

// Ordered by what to do first, not by what the pipeline depends on. The archive
// takes hours on LinkedIn's side, so it is requested early and used late —
// listing it second made a background wait look like a prerequisite, which it
// is not: intake, brief and roadmap all run without it.
const STEPS = [
  {
    href: "/archive",
    title: "Request your archive",
    body: "Two clicks on LinkedIn. Takes a few hours. Nothing below waits on it.",
  },
  {
    href: "/intake",
    title: "Do the intake",
    body: "Five or six questions. Do it now.",
  },
  {
    href: "/connect",
    title: "Connect LinkedIn",
    body: "Only for publishing. Nothing goes out without your approval.",
  },
  {
    href: "/review",
    title: "Review drafts",
    body: "Each draft shows the strategy it serves.",
  },
  {
    href: "/dashboard",
    title: "Watch it learn",
    body: "Confidence per category, and whether your edits are shrinking.",
  },
];

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
  const { complete } = await setupProgress();
  if (!complete) redirect("/setup");

  return (
    <main className="page">
      <header className="head">
        <div className="head-text">
          <h1>Welcome back</h1>
          <p className="lede">Strategy first, then the posts that execute it.</p>
        </div>
      </header>

      {STEPS.map((step, i) => (
        <Link className="step" href={step.href} key={step.href}>
          <span className="step-num">{i + 1}</span>
          <div>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>
        </Link>
      ))}

      <p className="note">
        No automated connection requests or DMs. Guru drafts; you send.
      </p>
    </main>
  );
}
