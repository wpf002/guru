import Link from "next/link";

export default function ConnectSuccessPage() {
  return (
    <main className="page">
      <h1>LinkedIn connected</h1>
      <p className="lede">
        Next, Guru needs your LinkedIn data archive — your connections, posting history,
        and past comments. That is what lets it open your intake already knowing your
        network and how you write, instead of asking you to describe both.
      </p>
      <Link className="button" href="/archive">
        Set up archive ingestion
      </Link>
    </main>
  );
}
