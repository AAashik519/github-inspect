import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchAction } from "./actions";
import { classifyGitFailure, describeError, GitError } from "./git/errors";
import { redact } from "./git/redact";
import { runDiagnostics } from "./git/diagnostics";
import { recordOperation, listOperations } from "./git/operations-log";
import { addRepository } from "./git/repositories";
import { assertRelativePath, assertRemoteUrl, requireRevision } from "./git/validate";
import { assertLocalRequest } from "./http/guard";
import { readStatus } from "./git/status";
import { cleanupTempDirs, createRepo, makeTempDir } from "./git/test-helpers";

beforeEach(() => {
  process.env.GIT_HISTORY_DATA_DIR = makeTempDir("git-history-data-");
});
afterEach(cleanupTempDirs);

describe("credential redaction", () => {
  it.each([
    ["fatal: unable to access 'https://user:hunter2@github.com/o/r.git/'", "hunter2"],
    ["remote: token=ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ghp_abcdef"],
    ["Authorization: Bearer abc.def.ghi", "abc.def.ghi"],
    ["url https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/o/r", "ghp_abcdef"],
  ])("removes secrets from %s", (text, secret) => {
    expect(redact(text)).not.toContain(secret);
  });

  it("scrubs credentials from classified Git failures", () => {
    const error = classifyGitFailure("fatal: Authentication failed for 'https://me:pa55word@host/r.git'", "", "failed");
    expect(error.kind).toBe("auth-failed");
    expect(JSON.stringify(describeError(error))).not.toContain("pa55word");
  });

  it("scrubs credentials from the operation log", () => {
    const entry = recordOperation({ repoId: "r", label: "x", command: redact("git remote add o https://u:pw123@h/r"), outcome: "success", durationMs: 1, output: "" });
    expect(listOperations("r")[0].command).not.toContain("pw123");
    expect(entry.id).toBeTruthy();
  });
});

describe("input validation", () => {
  it.each(["--upload-pack=x", "-h", "a b", "a..b", "x\u0000y", "a:b", "a^b", "a~1", "a[0]", ""])("rejects revision %j", (value) => {
    expect(() => requireRevision(value, "rev")).toThrow(GitError);
  });

  it("accepts branch, tag and hash style revisions", () => {
    for (const value of ["main", "feature/login-form", "origin/dev", "v1.2.3", "a1b2c3d4"]) expect(requireRevision(value, "rev")).toBe(value);
  });

  it.each(["../x", "/abs", "a/../b", "-rf", "C:\\x", "a\u0000b", ""])("rejects path %j", (value) => {
    expect(() => assertRelativePath(value)).toThrow(GitError);
  });

  it.each(["ext::sh -c id", "-oProxyCommand=x", "ftp://x", "relative", "https://a b/c"])("rejects remote URL %j", (value) => {
    expect(() => assertRemoteUrl(value)).toThrow(GitError);
  });

  it.each(["https://github.com/o/r.git", "ssh://git@host/o/r.git", "git@github.com:o/r.git", "/srv/git/repo.git", "file:///srv/repo"])("accepts remote URL %s", (value) => {
    expect(assertRemoteUrl(value)).toBe(value);
  });
});

describe("dispatcher", () => {
  it("only runs registered actions and never exposes arbitrary git commands", async () => {
    await expect(dispatchAction({ action: "exec", params: { args: ["status"] } })).rejects.toMatchObject({ kind: "validation" });
    await expect(dispatchAction({ action: "constructor" })).rejects.toMatchObject({ kind: "validation" });
    await expect(dispatchAction({ action: "__proto__" })).rejects.toMatchObject({ kind: "validation" });
    await expect(dispatchAction({ action: 42 })).rejects.toMatchObject({ kind: "validation" });
  });

  it("requires a registered repository id — raw paths are not accepted", async () => {
    const repo = createRepo();
    await expect(dispatchAction({ action: "repo.status", repoId: repo.dir })).rejects.toMatchObject({ kind: "repository-missing" });
    await expect(dispatchAction({ action: "repo.status" })).rejects.toMatchObject({ kind: "validation" });
  });

  it("serves registered repositories end to end", async () => {
    const repo = createRepo();
    const entry = (await dispatchAction({ action: "repos.add", params: { path: repo.dir } })) as { id: string };
    const status = (await dispatchAction({ action: "repo.status", repoId: entry.id })) as { head: { branch: string } };
    expect(status.head.branch).toBe("main");
    const result = (await dispatchAction({ action: "branches.create", repoId: entry.id, params: { name: "via-api", checkout: true } })) as { outcome: string };
    expect(result.outcome).toBe("success");
    const operations = (await dispatchAction({ action: "repo.operations", repoId: entry.id })) as { label: string }[];
    expect(operations[0].label).toBe("Create branch via-api");
  });

  it("does not run repository content as a shell: hostile branch names stay inert", async () => {
    const repo = createRepo();
    const entry = (await addRepository(repo.dir)).id;
    await expect(dispatchAction({ action: "branches.create", repoId: entry, params: { name: "x; touch /tmp/pwned-by-git-history" } })).rejects.toMatchObject({ kind: "validation" });
  });
});

describe("request guard", () => {
  const request = (headers: Record<string, string>) => new Request("http://localhost:3000/api/git", { method: "POST", headers });
  const jsonHeaders = { "content-type": "application/json" };

  it("accepts same-origin loopback requests", () => {
    expect(() => assertLocalRequest(request({ ...jsonHeaders, host: "localhost:3000", origin: "http://localhost:3000" }))).not.toThrow();
    expect(() => assertLocalRequest(request({ ...jsonHeaders, host: "127.0.0.1:3000" }))).not.toThrow();
  });

  it("rejects foreign hosts (DNS rebinding), foreign origins (CSRF) and non-JSON bodies", () => {
    expect(() => assertLocalRequest(request({ ...jsonHeaders, host: "evil.example.com" }))).toThrow(/localhost/);
    expect(() => assertLocalRequest(request({ ...jsonHeaders, host: "localhost:3000", origin: "https://evil.example.com" }))).toThrow(/Cross-origin/);
    expect(() => assertLocalRequest(request({ ...jsonHeaders, host: "localhost:3000", "sec-fetch-site": "cross-site" }))).toThrow(/Cross-site/);
    expect(() => assertLocalRequest(request({ "content-type": "text/plain", host: "localhost:3000" }))).toThrow(/JSON/);
  });
});

describe("diagnostics", () => {
  it("reports a healthy repository", async () => {
    const repo = createRepo();
    const report = await runDiagnostics(repo.ctx);
    expect(report.gitVersion).toMatch(/^\d+\.\d+/);
    expect(report.checks.some((check) => check.id === "healthy")).toBe(true);
  });

  it("reports detached HEAD, missing upstream, uncommitted changes and in-progress merges", async () => {
    const repo = createRepo();
    repo.git("remote", "add", "origin", "https://example.com/r.git");
    let ids = (await runDiagnostics(repo.ctx)).checks.map((check) => check.id);
    expect(ids).toContain("no-upstream");

    repo.write("app.txt", "dirty\n");
    repo.git("checkout", "-q", "--detach");
    ids = (await runDiagnostics(repo.ctx)).checks.map((check) => check.id);
    expect(ids).toEqual(expect.arrayContaining(["detached-head", "uncommitted"]));
  });
});

describe("untrusted repository configuration", () => {
  it("does not run a program named by the repository's core.fsmonitor setting", async () => {
    const repo = createRepo();
    const marker = path.join(repo.dir, "..", `fsmonitor-ran-${path.basename(repo.dir)}`);
    const hook = path.join(repo.dir, "..", `hook-${path.basename(repo.dir)}.sh`);
    fs.writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    repo.git("config", "core.fsmonitor", hook);

    await readStatus(repo.ctx);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
