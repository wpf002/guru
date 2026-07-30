# LinkedIn setup

What to click, in order, and what each step actually unlocks.

Everything here needs your LinkedIn account and, at one point, agreement to
LinkedIn's API Terms of Use on behalf of you or your company. That is why this
is a checklist rather than a script.

Run `pnpm linkedin:doctor` after each credential change — it verifies the client
id and secret against LinkedIn, checks the redirect URI shape, and prints the
consent URL to test the flow.

---

## The thing to know before you start

**Publishing and engaging come from different products, and only one is
self-serve.** This is a correction to roadmap §0.1 — see
[the amendment](#amendment-to-01) below.

| What you want | Scope | Product | Access |
|---|---|---|---|
| Sign in, read own profile | `openid profile email` | Sign In with LinkedIn (OIDC) | Self-serve |
| Publish posts (§1.5) | `w_member_social` | Share on LinkedIn | Self-serve |
| Comment + react (§1.6) | `w_member_social_feed` | Community Management API | **Vetted application** |
| Read own post engagement (§0.3) | `r_member_social` | — | **Closed, no applications** |

So you can have Guru posting today, and the engagement engine after an approval
process. Plan for that order.

---

## 1. Company Page (do this first — it gates everything)

A Developer Portal app must be attached to a LinkedIn Company Page, and you must
be an admin of that page. If you don't have one, create it at
[linkedin.com/company/setup/new](https://www.linkedin.com/company/setup/new).

New pages sometimes need a moment before they're selectable in the Developer
Portal. If yours doesn't appear, it's usually that, not an error.

## 2. Create the app

[developer.linkedin.com/apps](https://www.linkedin.com/developers/apps) → **Create app**.

- Select the Company Page from step 1.
- Accept the API Terms of Use. **This is a legal agreement** — it binds whoever
  the page represents, so read it if that's a company rather than you.
- Verify the app from the **Settings** tab. Verification is a link you send to a
  page admin (possibly yourself) and click. Products stay unavailable until this
  is done.

## 3. Add the self-serve products

**Products** tab → request:

- **Sign In with LinkedIn using OpenID Connect**
- **Share on LinkedIn**

Both grant immediately. Together they give you
`openid profile email w_member_social` — enough for everything except the
engagement engine.

## 4. Set the redirect URI

**Auth** tab → *OAuth 2.0 settings* → **Authorized redirect URLs**:

```
http://localhost:3001/auth/linkedin/callback
```

LinkedIn matches this byte for byte — a trailing slash or `https` where you meant
`http` produces a `redirect_uri_mismatch` at consent time, which is a confusing
place to learn about a trailing slash. `pnpm linkedin:doctor` checks the shape
before you get there.

Add your production URL as a second entry when you have one.

## 5. Copy the credentials

**Auth** tab → *Application credentials*. Put them in `.env`:

```bash
LINKEDIN_CLIENT_ID="..."
LINKEDIN_CLIENT_SECRET="..."
LINKEDIN_REDIRECT_URI="http://localhost:3001/auth/linkedin/callback"
LINKEDIN_FEED_SCOPES_APPROVED="false"
```

The secret is shown in full **once**. A truncated paste fails in a way that
looks exactly like a wrong client id — the doctor tells the two apart.

Then:

```bash
pnpm linkedin:doctor
```

Expect the client id/secret check to pass and one warning that commenting is
disabled. That warning is correct at this stage.

## 6. Test the flow

```bash
pnpm dev
```

Open `http://localhost:3000/connect`, read the trust checkpoint, and connect.
You should land back on the success page with a `LinkedInAccount` row written.

At this point §1.0–§1.5 work end to end: connect, ingest, intake, brief, roadmap,
draft, refine, publish.

---

## 7. Community Management API — for the engagement engine

Only start this once the above works, because the application asks you to
demonstrate a working integration.

**Products** tab → **Community Management API** → *Request access*. Two tiers:

- **Development Tier** — an access form. Limited call volume (500/app,
  100/member per the current docs). Enough to build and test against.
- **Standard Tier** — requires a screencast demonstrating each use case you
  listed on the form. This is the one that unlocks production volume.

Two things that will otherwise cost you a rebuild:

- Request Development Tier on an app that has **no other API products**. The
  option is greyed out otherwise. LinkedIn's own FAQ says to create a second
  app for the request, get it approved, then request Standard Tier on your real
  app using the new app's client id — and discard the second app.
- Approval is not instant and Standard Tier is a review, not a form submission.

When the Portal shows it **Approved**:

```bash
LINKEDIN_FEED_SCOPES_APPROVED="true"
```

Then **every connected account must reconnect** — scopes are fixed at grant
time, so existing tokens will not have the new one.

> ⚠️ Do not set this flag early. LinkedIn rejects an authorization request that
> names an unapproved scope; it fails sign-in entirely rather than granting a
> subset. Guru defaults it to false for that reason, and
> `MissingScopeError` gives a 403 with an explanation if something tries to
> comment without it.

---

## What you cannot get

**`r_member_social`** — reading back engagement on your own posts. LinkedIn's
FAQ states plainly: *"`r_member_social` is a closed permission. We're not
accepting access requests at this time due to resource constraints."* Don't
budget time for an application; there's no queue to join.

Guru is designed around this (§0.3, §9): it tracks every post it publishes from
creation, and the success metrics are user-reported or derived from archive
diffs rather than read back from LinkedIn.

**Connection requests and DMs** — no sanctioned API path exists at any tier
(§0.4). Guru builds the target list and drafts the message; you send it.

---

## API version

`packages/linkedin/src/client.ts` pins `LINKEDIN_API_VERSION`. LinkedIn supports
each monthly version for a **minimum of one year**, then rejects it outright —
there is no fallback to the latest. Currently pinned to `202607`.

Check [the versioning page](https://learn.microsoft.com/en-us/linkedin/marketing/versioning)
yearly. A sunset version fails every call with a deprecation error.

---

## Amendment to §0.1

The roadmap's §0.1 says `w_member_social` covers comment and react, making the
engagement engine self-serve and a Phase 1 subsystem. That reads the **scope
description** — "post, comment, and like posts on behalf of an authenticated
member" — which does say that.

The **per-endpoint permission tables** say otherwise:

- [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) — lists `w_member_social`.
- [Comments API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api) — lists only `w_member_social_feed` and the organization equivalents.
- [Reactions API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/reactions-api) — same.

And the Community Management overview lists "create and manage posts, comments,
and reactions ... on behalf of individual profiles" as a use case of that vetted
product.

**What this changes:** §1.6 is not self-serve and cannot ship in Phase 1 without
an approval that takes weeks. **What it doesn't change:** the strategic argument.
Engagement-led growth is still the compliant answer to network growth, still
beats cold outreach, and is still worth applying for. It moves from "an unlock
nobody noticed" to "a vetted product worth the paperwork" — and the code is
written and tested, waiting on the flag.

The minimum shippable cut (§11) is therefore §1.0–§1.5, not §1.0–§1.6.
