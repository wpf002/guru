import Link from "next/link";

export default function Home() {
  return (
    <main className="page">
      <h1>Guru</h1>
      <p className="lede">
        A go-to-market strategist that lives on top of your LinkedIn presence. It learns
        your niche, your network, and how you actually write — then proposes strategy,
        content, and engagement you approve before anything is published.
      </p>
      <Link className="button" href="/connect">
        Connect LinkedIn
      </Link>
    </main>
  );
}
