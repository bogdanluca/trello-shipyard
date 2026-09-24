import { describe, expect, it } from "vitest";
import { parseRepos } from "./repos";

describe("parseRepos", () => {
  it("parses owner/name lines, urls, and optional branches", () => {
    const repos = parseRepos(`
      acme/api
      https://github.com/acme/web.git
      acme/mobile:master
      # ignored
      not-a-repo
    `);

    expect(repos).toEqual([
      { owner: "acme", name: "api", fullName: "acme/api", branch: undefined },
      { owner: "acme", name: "web", fullName: "acme/web", branch: undefined },
      { owner: "acme", name: "mobile", fullName: "acme/mobile", branch: "master" },
    ]);
  });
});
