import { afterEach, describe, expect, it } from "vitest";
import { addRemote, fetchRemote, listRemotes, pullBranch, pushBranch, removeRemote, setRemoteUrl, syncStatus } from "./remotes";
import { readStatus } from "./status";
import { cleanupTempDirs, cloneRemote, createRepo, createRepoWithRemote, makeTempDir, sh } from "./test-helpers";

afterEach(cleanupTempDirs);

describe("remote management", () => {
  it("adds, lists, edits and removes remotes", async () => {
    const repo = createRepo();
    const bare = makeTempDir();
    sh(bare, "init", "-q", "--bare");

    await addRemote(repo.ctx, { name: "origin", url: bare });
    await expect(addRemote(repo.ctx, { name: "origin", url: bare })).rejects.toMatchObject({ kind: "ref-exists" });

    const other = makeTempDir();
    await setRemoteUrl(repo.ctx, { name: "origin", url: other });
    expect((await listRemotes(repo.ctx))[0]).toMatchObject({ name: "origin", fetchUrl: other, pushUrl: other, branches: [] });

    await removeRemote(repo.ctx, { name: "origin" });
    expect(await listRemotes(repo.ctx)).toEqual([]);
    await expect(removeRemote(repo.ctx, { name: "origin" })).rejects.toMatchObject({ kind: "no-remote" });
  });

  it("rejects dangerous or malformed remote names and URLs", async () => {
    const repo = createRepo();
    for (const url of ["ext::sh -c 'touch /tmp/pwned'", "--upload-pack=evil", "javascript:alert(1)", "relative/path", "https://a b", ""]) {
      await expect(addRemote(repo.ctx, { name: "x", url })).rejects.toMatchObject({ kind: "validation" });
    }
    for (const name of ["-bad", "bad name", "../x", "a/b", ""]) {
      await expect(addRemote(repo.ctx, { name, url: "https://example.com/r.git" })).rejects.toMatchObject({ kind: "validation" });
    }
    expect(await listRemotes(repo.ctx)).toEqual([]);
  });

  it("never returns credentials embedded in a remote URL", async () => {
    const repo = createRepo();
    await addRemote(repo.ctx, { name: "origin", url: "https://user:s3cret-token@example.com/owner/repo.git" });
    const [remote] = await listRemotes(repo.ctx);
    expect(remote.fetchUrl).toBe("https://***@example.com/owner/repo.git");
    expect(JSON.stringify(remote)).not.toContain("s3cret");
  });
});

describe("fetch, pull and push", () => {
  it("pushes a new branch, setting its upstream, and verifies the remote state", async () => {
    const { local, remoteDir } = createRepoWithRemote();
    local.git("switch", "-q", "-c", "feature");
    local.commit("f1", { "f.txt": "1" });

    const result = await pushBranch(local.ctx, { remote: "origin", branch: "feature", setUpstream: true });
    expect(result.outcome).toBe("success");
    expect(local.git("--git-dir", remoteDir, "rev-parse", "feature")).toBe(local.git("rev-parse", "feature"));
    expect(local.git("rev-parse", "--abbrev-ref", "feature@{upstream}")).toBe("origin/feature");
    expect((await pushBranch(local.ctx, { remote: "origin", branch: "feature" })).outcome).toBe("noop");
  });

  it("fetches new remote commits and shows incoming and outgoing commits", async () => {
    const { local, remoteDir } = createRepoWithRemote();
    const other = cloneRemote(remoteDir);
    other.commit("from teammate", { "t.txt": "t" });
    other.git("push", "-q");
    local.commit("my local work", { "m.txt": "m" });

    expect((await syncStatus(local.ctx, {})).incoming).toEqual([]);
    await fetchRemote(local.ctx, { remote: "origin" });
    const sync = await syncStatus(local.ctx, {});
    expect(sync).toMatchObject({ remote: "origin", branch: "main", upstream: "origin/main" });
    expect(sync.incoming.map((commit) => commit.subject)).toEqual(["from teammate"]);
    expect(sync.outgoing.map((commit) => commit.subject)).toEqual(["my local work"]);
    expect(sync.conflicts).toEqual({ supported: true, hasConflicts: false, files: [] });
  });

  it("fetches all remotes and reports nothing new honestly", async () => {
    const { local } = createRepoWithRemote();
    expect((await fetchRemote(local.ctx, { remote: null })).outcome).toBe("noop");
  });

  it("fast-forward pulls, and offers merge or rebase when diverged", async () => {
    const { local, remoteDir } = createRepoWithRemote();
    const other = cloneRemote(remoteDir);
    other.commit("teammate 1", { "t.txt": "1" });
    other.git("push", "-q");
    await fetchRemote(local.ctx, { remote: "origin" });

    const pulled = await pullBranch(local.ctx, { remote: "origin", branch: "main", mode: "ff-only" });
    expect(pulled.outcome).toBe("success");
    expect(local.read("t.txt")).toBe("1");

    other.commit("teammate 2", { "t.txt": "2" });
    other.git("push", "-q");
    local.commit("local diverges", { "l.txt": "l" });
    await expect(pullBranch(local.ctx, { remote: "origin", branch: "main", mode: "ff-only" })).rejects.toMatchObject({ kind: "non-fast-forward" });

    const merged = await pullBranch(local.ctx, { remote: "origin", branch: "main", mode: "merge" });
    expect(merged.outcome).toBe("success");
    expect(local.read("t.txt")).toBe("2");
    expect((await pullBranch(local.ctx, { remote: "origin", branch: "main", mode: "merge" })).outcome).toBe("noop");
  });

  it("stops a conflicting pull and leaves a resumable merge", async () => {
    const { local, remoteDir } = createRepoWithRemote();
    const other = cloneRemote(remoteDir);
    other.commit("their edit", { "app.txt": "line 1\nTHEIRS\nline 3\n" });
    other.git("push", "-q");
    local.commit("my edit", { "app.txt": "line 1\nMINE\nline 3\n" });
    const result = await pullBranch(local.ctx, { remote: "origin", branch: "main", mode: "merge" });
    expect(result.outcome).toBe("conflict");
    expect((await readStatus(local.ctx)).inProgress?.kind).toBe("merge");
  });

  it("rejects a non-fast-forward push with an explanation, and keeps the remote intact", async () => {
    const { local, remoteDir } = createRepoWithRemote();
    const other = cloneRemote(remoteDir);
    const teammate = other.commit("teammate", { "t.txt": "t" });
    other.git("push", "-q");
    local.commit("local only", { "l.txt": "l" });

    await expect(pushBranch(local.ctx, { remote: "origin", branch: "main" })).rejects.toMatchObject({ kind: "non-fast-forward" });
    expect(local.git("--git-dir", remoteDir, "rev-parse", "main")).toBe(teammate);
  });

  it("only force-pushes after the branch name is typed, and uses force-with-lease", async () => {
    const { local, remoteDir } = createRepoWithRemote();
    const other = cloneRemote(remoteDir);
    other.commit("teammate", { "t.txt": "t" });
    other.git("push", "-q");
    await fetchRemote(local.ctx, { remote: "origin" });
    local.commit("local only", { "l.txt": "l" });

    await expect(pushBranch(local.ctx, { remote: "origin", branch: "main", force: true })).rejects.toMatchObject({ kind: "validation" });
    await expect(pushBranch(local.ctx, { remote: "origin", branch: "main", force: true, forceConfirm: "wrong" })).rejects.toMatchObject({ kind: "validation" });
    await pushBranch(local.ctx, { remote: "origin", branch: "main", force: true, forceConfirm: "main" });
    expect(local.git("--git-dir", remoteDir, "rev-parse", "main")).toBe(local.git("rev-parse", "main"));
  });

  it("refuses a lease-protected force push when the remote moved after the last fetch", async () => {
    const { local, remoteDir } = createRepoWithRemote();
    const other = cloneRemote(remoteDir);
    const teammate = other.commit("teammate", { "t.txt": "t" });
    other.git("push", "-q");
    local.commit("local only", { "l.txt": "l" }); // never fetched teammate's commit
    await expect(pushBranch(local.ctx, { remote: "origin", branch: "main", force: true, forceConfirm: "main" })).rejects.toMatchObject({ kind: "non-fast-forward" });
    expect(local.git("--git-dir", remoteDir, "rev-parse", "main")).toBe(teammate);
  });

  it("fails clearly for missing remotes, unreachable servers and missing upstreams", async () => {
    const repo = createRepo();
    await expect(fetchRemote(repo.ctx, { remote: null })).rejects.toMatchObject({ kind: "no-remote" });
    await expect(pushBranch(repo.ctx, { remote: "origin", branch: "main" })).rejects.toMatchObject({ kind: "no-remote" });

    await addRemote(repo.ctx, { name: "origin", url: "https://does-not-exist.invalid/repo.git" });
    await expect(fetchRemote(repo.ctx, { remote: "origin" })).rejects.toMatchObject({ kind: "network" });
    expect(await syncStatus(repo.ctx, {})).toMatchObject({ remote: null, incoming: [], outgoing: [] });
  });

  it("refuses a merge-style pull while changes are uncommitted and while detached", async () => {
    const { local } = createRepoWithRemote();
    local.write("app.txt", "dirty\n");
    await expect(pullBranch(local.ctx, { remote: "origin", branch: "main", mode: "merge" })).rejects.toMatchObject({ kind: "dirty-worktree" });
    local.git("checkout", "-q", "--", ".");
    local.git("checkout", "-q", "--detach");
    await expect(pullBranch(local.ctx, { remote: "origin", branch: "main", mode: "ff-only" })).rejects.toMatchObject({ kind: "precondition" });
  });
});
