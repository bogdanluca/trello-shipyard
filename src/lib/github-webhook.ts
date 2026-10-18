import { createHmac, timingSafeEqual } from "crypto";
import type { RepoRef } from "./types";

export type GithubPushPayload = {
  ref?: string;
  repository?: {
    full_name?: string;
    default_branch?: string;
  };
};

export function verifyGithubSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null
) {
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(`sha256=${digest}`);
  const actual = Buffer.from(signatureHeader);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function matchWatchedPush(repos: RepoRef[], payload: GithubPushPayload) {
  const fullName = payload.repository?.full_name;
  const ref = payload.ref ?? "";
  if (!fullName) {
    return { ok: false as const, reason: "Payload is missing repository.full_name." };
  }
  if (!ref.startsWith("refs/heads/")) {
    return { ok: false as const, reason: `Ignoring ref ${ref || "(none)"}.` };
  }

  const branch = ref.slice("refs/heads/".length);
  const repo = repos.find(
    (item) => item.fullName.toLowerCase() === fullName.toLowerCase()
  );
  if (!repo) {
    return { ok: false as const, reason: `Ignoring unwatched repo ${fullName}.` };
  }

  const watched =
    repo.branch || payload.repository?.default_branch || "main";
  if (branch !== watched) {
    return {
      ok: false as const,
      reason: `Ignoring ${fullName}@${branch}; watching ${watched}.`,
    };
  }

  return { ok: true as const, repo: repo.fullName, branch };
}
