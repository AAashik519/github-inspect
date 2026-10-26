import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFileDiff } from "./diff";
import { applyStashEntry, createStash, dropStash, listStashes, popStashEntry, stashFiles } from "./stash";
import { checkoutTag, createTag, deleteRemoteTag, deleteTag, listTags, pushTag, tagMessage } from "./tags";
import { listConflicts } from "./conflicts";
import { currentBranch } from "./context";
import { cleanupTempDirs, createRepo, createRepoWithRemote } from "./test-helpers";

afterEach(cleanupTempDirs);

describe("stash", () => {
  it("stashes local changes with a message, lists them and restores them with pop", async () => {
    const repo = createRepo();
    repo.write("app.txt", "edited\n");
    await createStash(repo.ctx, { message: "work in progress" });
    expect(repo.git("status", "--porcelain")).toBe("");

    const [stash] = await listStashes(repo.ctx);
    expect(stash).toMatchObject({ ref: "stash@{0}", branch: "main" });
    expect(stash.message).toContain("work in progress");

    await popStashEntry(repo.ctx, { ref: "stash@{0}" });
    expect(repo.read("app.txt")).toBe("edited\n");
    expect(await listStashes(repo.ctx)).toEqual([]);
  });

  it("includes untracked files only when asked", async () => {
    const repo = createRepo();
    repo.write("new.txt", "new\n");
    await expect(createStash(repo.ctx, {})).rejects.toMatchObject({ kind: "precondition" });
    await createStash(repo.ctx, { includeUntracked: true });
    expect(fs.existsSync(path.join(repo.dir, "new.txt"))).toBe(false);
    const files = await stashFiles(repo.ctx, "stash@{0}");
    expect(files.map((file) => file.path)).toEqual(["new.txt"]);
    const diff = await getFileDiff(repo.ctx, { kind: "stash", ref: "stash@{0}", path: "new.txt" });
    expect(diff.files[0].additions).toBe(1);
  });

  it("shows stash contents and diffs", async () => {
    const repo = createRepo();
    repo.write("app.txt", "line 1\nCHANGED\nline 3\n");
    await createStash(repo.ctx, {});
    const files = await stashFiles(repo.ctx, "stash@{0}");
    expect(files).toEqual([{ path: "app.txt", status: "M", additions: 1, deletions: 1, binary: false }]);
    const diff = await getFileDiff(repo.ctx, { kind: "stash", ref: "stash@{0}", path: "app.txt" });
    expect(diff.files[0].hunks[0].lines.some((line) => line.text === "CHANGED")).toBe(true);
  });

  it("apply keeps the stash, drop removes it and reports how to recover", async () => {
    const repo = createRepo();
    repo.write("app.txt", "edited\n");
    await createStash(repo.ctx, {});
    await applyStashEntry(repo.ctx, { ref: "stash@{0}" });
    expect(await listStashes(repo.ctx)).toHaveLength(1);
    const [stash] = await listStashes(repo.ctx);
    const dropped = await dropStash(repo.ctx, { ref: "stash@{0}" });
    expect(dropped.summary).toContain(stash.hash);
    expect(await listStashes(repo.ctx)).toEqual([]);
  });

  it("reports conflicts when applying onto conflicting changes and keeps the stash on pop", async () => {
    const repo = createRepo();
    repo.write("app.txt", "line 1\nSTASHED\nline 3\n");
    await createStash(repo.ctx, {});
    repo.commit("conflicting commit", { "app.txt": "line 1\nCOMMITTED\nline 3\n" });

    const result = await popStashEntry(repo.ctx, { ref: "stash@{0}" });
    expect(result.outcome).toBe("conflict");
    expect(await listConflicts(repo.ctx)).toHaveLength(1);
    expect(await listStashes(repo.ctx)).toHaveLength(1);
  });

  it("refuses to overwrite local changes when applying", async () => {
    const repo = createRepo();
    repo.write("app.txt", "stashed\n");
    await createStash(repo.ctx, {});
    repo.write("app.txt", "local edit in the way\n");
    await expect(applyStashEntry(repo.ctx, { ref: "stash@{0}" })).rejects.toMatchObject({ kind: "dirty-worktree" });
    expect(repo.read("app.txt")).toBe("local edit in the way\n");
  });

  it("validates stash references", async () => {
    const repo = createRepo();
    await expect(dropStash(repo.ctx, { ref: "HEAD" })).rejects.toMatchObject({ kind: "validation" });
    await expect(dropStash(repo.ctx, { ref: "stash@{5}" })).rejects.toMatchObject({ kind: "ref-not-found" });
    await expect(createStash(createRepo({ initialCommit: false }).ctx, {})).rejects.toMatchObject({ kind: "precondition" });
  });
});

describe("tags", () => {
  it("creates lightweight and annotated tags with correct details", async () => {
    const repo = createRepo();
    await createTag(repo.ctx, { name: "v1.0.0" });
    await createTag(repo.ctx, { name: "v1.1.0", message: "Release 1.1\n\nNotes here" });

    const tags = await listTags(repo.ctx);
    const light = tags.find((tag) => tag.name === "v1.0.0")!;
    const annotated = tags.find((tag) => tag.name === "v1.1.0")!;
    expect(light).toMatchObject({ type: "lightweight", hash: repo.git("rev-parse", "HEAD"), commitSubject: "initial commit", tagger: null });
    expect(annotated).toMatchObject({ type: "annotated", hash: repo.git("rev-parse", "HEAD"), message: "Release 1.1", tagger: "Test Committer" });
    expect(await tagMessage(repo.ctx, "v1.1.0")).toContain("Notes here");
  });

  it("tags a chosen commit and rejects duplicates and invalid names", async () => {
    const repo = createRepo();
    const first = repo.git("rev-parse", "HEAD");
    repo.commit("second", { "a.txt": "a" });
    await createTag(repo.ctx, { name: "old", revision: first });
    expect((await listTags(repo.ctx))[0].hash).toBe(first);
    await expect(createTag(repo.ctx, { name: "old" })).rejects.toMatchObject({ kind: "ref-exists" });
    await expect(createTag(repo.ctx, { name: "bad tag" })).rejects.toMatchObject({ kind: "validation" });
    await expect(createTag(repo.ctx, { name: "-x" })).rejects.toMatchObject({ kind: "validation" });
  });

  it("deletes local tags and does not touch remote ones", async () => {
    const { local, remoteDir } = createRepoWithRemote();
    await createTag(local.ctx, { name: "v1" });
    await pushTag(local.ctx, { remote: "origin", name: "v1" });
    await deleteTag(local.ctx, { name: "v1" });
    expect(await listTags(local.ctx)).toEqual([]);
    expect(local.git("--git-dir", remoteDir, "tag", "--list")).toBe("v1");
  });

  it("does not publish a tag until pushed, and remote deletion needs the typed name", async () => {
    const { local, remoteDir } = createRepoWithRemote();
    await createTag(local.ctx, { name: "v2" });
    expect(local.git("--git-dir", remoteDir, "tag", "--list")).toBe("");
    await pushTag(local.ctx, { remote: "origin", name: "v2" });
    expect(local.git("--git-dir", remoteDir, "tag", "--list")).toBe("v2");

    await expect(deleteRemoteTag(local.ctx, { remote: "origin", name: "v2", confirmName: "nope" })).rejects.toMatchObject({ kind: "validation" });
    await deleteRemoteTag(local.ctx, { remote: "origin", name: "v2", confirmName: "v2" });
    expect(local.git("--git-dir", remoteDir, "tag", "--list")).toBe("");
    expect(await listTags(local.ctx)).toHaveLength(1);
  });

  it("checks out a tag as a detached HEAD", async () => {
    const repo = createRepo();
    await createTag(repo.ctx, { name: "v1" });
    repo.commit("later", { "a.txt": "a" });
    await checkoutTag(repo.ctx, { name: "v1" });
    expect(await currentBranch(repo.ctx)).toBeNull();
    expect(repo.git("rev-parse", "HEAD")).toBe(repo.git("rev-parse", "v1^{commit}"));
  });
});
