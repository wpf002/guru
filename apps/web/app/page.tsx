import Link from "next/link";
import { currentUser } from "../lib/api";

// Ordered by what to do first, not by what the pipeline depends on. The archive
// takes hours on LinkedIn's side, so it is requested early and used late —
// listing it second made a background wait look like a prerequisite, which it
// is not: intake, brief and roadmap all run without it.
const STEPS = [
  {
    href: "/archive",
    title: "Request your archive",
    body: "Two clicks on LinkedIn, then forget about it. It takes a few hours, and no email will arrive — you come back for it. Nothing below waits on this.",
  },
  {
    href: "/intake",
    title: "Do the intake",
    body: "Five or six questions. Start it now, while the archive is building.",
  },
  {
    href: "/connect",
    title: "Connect LinkedIn",
    body: "Only needed when you want Guru to publish for you. Read-only identity, plus permission to post — only ever on things you have approved.",
  },
  {
    href: "/review",
    title: "Review drafts",
    body: "Every post and comment shows the strategy it serves. Nothing goes out without you.",
  },
  {
    href: "/dashboard",
    title: "Watch it learn",
    body: "Confidence by category, and whether the edits you make per draft are going down.",
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
          A go-to-market strategist that lives on top of your LinkedIn presence. It learns
          your niche, your network, and how you actually write — then proposes the
          strategy, the posts, and the comments that execute it.
        </p>
        <p>
          <Link className="button" href="/login?mode=signup">
            Create an account
          </Link>{" "}
          <Link href="/login">or sign in</Link>
        </p>
        <p className="note">
          Guru does not send connection requests or DMs. There is no compliant API for
          either, and the tools that claim otherwise put your account at risk — which is
          the one asset this is all meant to grow. It builds the list and drafts the
          message; you press send.
        </p>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Welcome back</h1>
      <p className="lede">
        A go-to-market strategist that lives on top of your LinkedIn presence. It learns
        your niche, your network, and how you actually write — then proposes the strategy,
        the posts, and the comments that execute it.
      </p>

      {STEPS.map((step, i) => (
        <Link className="step" href={step.href} key={step.href}>
          <h2>
            <span className="step-num">{i + 1}</span>
            {step.title}
          </h2>
          <p>{step.body}</p>
        </Link>
      ))}

      <p className="note">
        Guru does not send connection requests or DMs. There is no compliant API for
        either, and the tools that claim otherwise put your account at risk — which is the
        one asset this is all meant to grow. It builds the list and drafts the message;
        you press send.
      </p>
    </main>
  );
}
