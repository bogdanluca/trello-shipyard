import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { matchWatchedPush, verifyGithubSignature } from "./github-webhook";
import { parseRepos } from "./repos";

describe("verifyGithubSignature", () => {
  it("accepts a matching sha256 HMAC", () => {
    const secret = "webhook-secret";
    const body = "{\"zen\":\"Nice\"}";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyGithubSignature(secret, body, signature)).toBe(true);
  });

  it("rejects a bad signature", () => {
    expect(
      verifyGithubSignature("webhook-secret", "{}", "sha256=deadbeef")
    ).toBe(false);
  });
});

describe("matchWatchedPush", () => {
  const repos = parseRepos("acme/api\nacme/web:develop");

  it("accepts a push to the default branch of a watched repo", () => {
    expect(
      matchWatchedPush(repos, {
        ref: "refs/heads/main",
        repository: { full_name: "acme/api", default_branch: "main" },
      })
    ).toEqual({ ok: true, repo: "acme/api", branch: "main" });
  });

  it("accepts a push to a configured branch", () => {
    expect(
      matchWatchedPush(repos, {
        ref: "refs/heads/develop",
        repository: { full_name: "acme/web", default_branch: "main" },
      }).ok
    ).toBe(true);
  });

  it("ignores other branches and repos", () => {
    expect(
      matchWatchedPush(repos, {
        ref: "refs/heads/feature",
        repository: { full_name: "acme/api", default_branch: "main" },
      }).ok
    ).toBe(false);
    expect(
      matchWatchedPush(repos, {
        ref: "refs/heads/main",
        repository: { full_name: "acme/other", default_branch: "main" },
      }).ok
    ).toBe(false);
  });
});
