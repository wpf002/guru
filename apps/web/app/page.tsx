import Link from "next/link";

const STEPS = [
  {
    href: "/connect",
    title: "Connect LinkedIn",
    body: "Read-only identity, plus permission to post and comment — only ever on things you have approved.",
  },
  {
    href: "/archive",
    title: "Bring in your archive",
    body: "Connections, posting history, and every comment you have left. This is what lets Guru write in your voice on day one.",
  },
  {
    href: "/intake",
    title: "Do the intake",
    body: "Five areas, one at a time. Two arrive mostly answered because Guru already read your archive.",
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

export default function Home() {
  return (
    <main className="page">
      <h1>Guru</h1>
      <p className="lede">
        A go-to-market strategist that lives on top of your LinkedIn presence. It learns
        your niche, your network, and how you actually write — then proposes the strategy,
        the posts, and the comments that execute it.
      </p>

      {STEPS.map((step) => (
        <section className="draft" key={step.href}>
          <h2 style={{ marginTop: 0 }}>
            <Link href={step.href}>{step.title}</Link>
          </h2>
          <p style={{ margin: 0, color: "var(--muted)" }}>{step.body}</p>
        </section>
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
