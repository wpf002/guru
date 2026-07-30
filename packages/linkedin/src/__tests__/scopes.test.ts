import { describe, expect, it } from "vitest";
import {
  BASE_SCOPES,
  MissingScopeError,
  assertCapability,
  capabilities,
  hasCapability,
  parseGrantedScopes,
  requestedScopes,
} from "../scopes.js";
import { authorizationUrl } from "../oauth.js";

const config = {
  clientId: "abc",
  clientSecret: "shh",
  redirectUri: "http://localhost:3001/cb",
};

describe("requestedScopes", () => {
  it("asks only for the self-serve set by default", () => {
    // Requesting an unapproved scope makes LinkedIn reject the whole
    // authorization request — it does not grant a subset.
    expect(requestedScopes({ feedApproved: false })).toEqual([...BASE_SCOPES]);
    expect(requestedScopes({ feedApproved: false })).not.toContain("w_member_social_feed");
  });

  it("adds the feed scope once Community Management is approved", () => {
    expect(requestedScopes({ feedApproved: true })).toContain("w_member_social_feed");
  });
});

describe("authorizationUrl", () => {
  it("omits the feed scope unless explicitly approved", () => {
    const url = new URL(authorizationUrl(config, "state123"));
    expect(url.searchParams.get("scope")).toBe("openid profile email w_member_social");
  });

  it("includes it when approved", () => {
    const url = new URL(authorizationUrl({ ...config, feedScopesApproved: true }, "s"));
    expect(url.searchParams.get("scope")).toContain("w_member_social_feed");
  });
});

describe("parseGrantedScopes", () => {
  it("handles space- and comma-separated forms", () => {
    expect([...parseGrantedScopes("openid profile w_member_social")]).toEqual([
      "openid",
      "profile",
      "w_member_social",
    ]);
    expect(parseGrantedScopes("openid,profile").has("profile")).toBe(true);
  });

  it("treats an absent scope string as no capabilities", () => {
    // Better to refuse than to attempt a publish that 403s.
    expect(parseGrantedScopes(null).size).toBe(0);
    expect(parseGrantedScopes(undefined).size).toBe(0);
  });
});

describe("capabilities", () => {
  it("separates publishing from commenting and reacting", () => {
    // The correction to §0.1: w_member_social alone does not cover the
    // engagement engine.
    const publishOnly = parseGrantedScopes("openid profile email w_member_social");
    expect(capabilities(publishOnly)).toEqual({
      PUBLISH: true,
      COMMENT: false,
      REACT: false,
    });
  });

  it("unlocks engagement with the feed scope", () => {
    const full = parseGrantedScopes("w_member_social w_member_social_feed");
    expect(capabilities(full)).toEqual({ PUBLISH: true, COMMENT: true, REACT: true });
  });

  it("reports no capabilities for an empty grant", () => {
    expect(hasCapability(parseGrantedScopes(""), "PUBLISH")).toBe(false);
  });
});

describe("assertCapability", () => {
  it("passes when the scope is present", () => {
    const granted = parseGrantedScopes("w_member_social");
    expect(() => assertCapability(granted, "PUBLISH")).not.toThrow();
  });

  it("explains how to get the vetted scope rather than just failing", () => {
    const granted = parseGrantedScopes("w_member_social");
    try {
      assertCapability(granted, "COMMENT");
      expect.unreachable();
    } catch (e) {
      const err = e as MissingScopeError;
      expect(err).toBeInstanceOf(MissingScopeError);
      expect(err.requiredScope).toBe("w_member_social_feed");
      expect(err.message).toMatch(/Community Management API/);
      // The distinction that matters operationally: this is not total failure.
      expect(err.message).toMatch(/Publishing still works/);
    }
  });

  it("points at Share on LinkedIn when publishing is the missing one", () => {
    try {
      assertCapability(parseGrantedScopes("openid"), "PUBLISH");
      expect.unreachable();
    } catch (e) {
      expect((e as MissingScopeError).message).toMatch(/Share on LinkedIn/);
    }
  });
});
