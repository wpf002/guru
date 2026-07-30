const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * The trust checkpoint — roadmap §1.0.
 *
 * Shown before the consent redirect, in plain language, in-product. The spec
 * calls this out explicitly and the reason is that LinkedIn's own consent screen
 * lists scope names, not intentions: "w_member_social" tells a user nothing
 * about what this product will do with it.
 *
 * What is promised here is enforced elsewhere — nothing publishes without
 * approval in Phase 1, and disconnect deletes tokens rather than flagging them.
 */
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="page">
      <h1>Connect your LinkedIn account</h1>

      {error ? (
        <p className="error" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}

      <p className="lede">
        Before you approve anything, here is exactly what Guru gets and what it does with
        it.
      </p>

      <section className="checkpoint">
        <h2>What Guru can read</h2>
        <ul>
          <li>
            <strong>Your name, profile photo, and email address.</strong> Used to identify
            your account. Nothing else.
          </li>
        </ul>

        <h2>What Guru can do</h2>
        <ul>
          <li>
            <strong>Publish posts to your feed</strong> — only ones you have read and
            approved.
          </li>
          <li>
            <strong>Comment and react on other people&rsquo;s posts as you</strong> — again,
            only ones you have approved. This is how Guru grows your network without
            cold-messaging anyone.
          </li>
        </ul>

        <h2>What Guru cannot do</h2>
        <ul>
          <li>Send connection requests or DMs. There is no automated path for either, and
            we do not use the workarounds that put accounts at risk.</li>
          <li>Post, comment, or react without your approval. Not at any confidence level.</li>
          <li>Read your feed, your messages, or anyone else&rsquo;s private data.</li>
        </ul>

        <h2>Your access tokens</h2>
        <ul>
          <li>Encrypted before they are stored, never written to logs, never sent to your
            browser.</li>
          <li>
            One click disconnects and <strong>deletes</strong> them — not a flag, an actual
            delete. Processing halts immediately.
          </li>
        </ul>
      </section>

      <p className="note">
        LinkedIn shows all permissions on a single screen and you must accept all or none.
        The list above is the complete set we ask for.
      </p>

      <a className="button" href={`${API_URL}/auth/linkedin/start`}>
        Continue to LinkedIn
      </a>
    </main>
  );
}

function errorMessage(code: string): string {
  switch (code) {
    case "invalid_state":
      return "That sign-in link expired or did not match. Please try again.";
    case "connection_failed":
      return "We could not complete the connection with LinkedIn. Please try again.";
    default:
      return code;
  }
}
