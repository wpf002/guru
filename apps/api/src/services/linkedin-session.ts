import { prisma } from "@guru/db";
import { decryptToken, encryptToken } from "@guru/core";
import {
  LinkedInAuthError,
  LinkedInClient,
  needsRefresh,
  refreshAccessToken,
} from "@guru/linkedin";
import type { Env } from "../env.js";

/**
 * Building an authenticated LinkedIn client — roadmap §1.0 and §0.8.
 *
 * Rotation happens here, on the way to every call, rather than on a timer. A
 * token that expires between the scheduler picking up a post and the publish
 * call is a failed post the user finds out about later, and a refresh margin is
 * cheaper than that.
 */

export class ReauthRequiredError extends Error {
  constructor(readonly userId: string) {
    super("LinkedIn connection needs to be re-authorized.");
    this.name = "ReauthRequiredError";
  }
}

export class LinkedInNotConfiguredError extends Error {
  constructor() {
    super(
      "LinkedIn is not configured on this deployment, so publishing is unavailable. " +
        "Copy the draft and post it yourself, or see docs/LINKEDIN-SETUP.md.",
    );
    this.name = "LinkedInNotConfiguredError";
  }
}

export async function linkedInClientFor(env: Env, userId: string): Promise<LinkedInClient> {
  if (!env.linkedin) throw new LinkedInNotConfiguredError();

  const account = await prisma.linkedInAccount.findUnique({ where: { userId } });
  if (!account || account.disconnectedAt) {
    throw new ReauthRequiredError(userId);
  }

  let accessToken = decryptToken(account.accessTokenCipher);

  if (needsRefresh(account.accessTokenExpiresAt)) {
    if (!account.refreshTokenCipher) {
      // Refresh tokens are only issued to approved applications. Without one the
      // member re-authorizes at expiry — which is why this is a typed error the
      // UI can act on rather than a generic failure.
      await flagReauth(userId);
      throw new ReauthRequiredError(userId);
    }

    try {
      const refreshed = await refreshAccessToken(
        env.linkedin!,
        decryptToken(account.refreshTokenCipher),
      );
      accessToken = refreshed.accessToken;

      await prisma.linkedInAccount.update({
        where: { userId },
        data: {
          accessTokenCipher: encryptToken(refreshed.accessToken),
          refreshTokenCipher: refreshed.refreshToken
            ? encryptToken(refreshed.refreshToken)
            : account.refreshTokenCipher,
          accessTokenExpiresAt: refreshed.expiresAt,
          refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt ?? account.refreshTokenExpiresAt,
          lastRefreshedAt: new Date(),
          refreshFailureCount: 0,
        },
      });
    } catch (err) {
      await flagReauth(userId);
      if (err instanceof LinkedInAuthError) throw new ReauthRequiredError(userId);
      throw err;
    }
  }

  // Scopes as *granted*, read from the stored grant rather than from config —
  // LinkedIn can return a narrower set than was asked for, and assuming
  // otherwise means discovering the difference at publish time.
  return new LinkedInClient(
    accessToken,
    LinkedInClient.personUrnFromSub(account.linkedinSub),
    account.scopes,
  );
}

/**
 * Counted rather than booleaned so the dashboard can distinguish a transient
 * blip from a connection that has genuinely lapsed.
 */
async function flagReauth(userId: string) {
  await prisma.linkedInAccount.update({
    where: { userId },
    data: { refreshFailureCount: { increment: 1 } },
  });
}
