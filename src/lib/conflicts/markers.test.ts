import { describe, expect, it } from "vitest";
import { composeResolution, hasConflictMarkers, parseConflictMarkers } from "./markers";

const CONFLICTED = `head
<<<<<<< HEAD
ours line
=======
theirs line
>>>>>>> feature
tail
`;

describe("parseConflictMarkers", () => {
  it("splits a file into text and conflict segments", () => {
    const parsed = parseConflictMarkers(CONFLICTED);
    expect(parsed.conflictCount).toBe(1);
    expect(parsed.isMalformed).toBe(false);
    const conflict = parsed.segments[1];
    expect(conflict).toMatchObject({ kind: "conflict", ours: "ours line\n", theirs: "theirs line\n", oursLabel: "HEAD" });
  });

  it("reads the diff3 base section", () => {
    const parsed = parseConflictMarkers("<<<<<<< HEAD\na\n||||||| base\nb\n=======\nc\n>>>>>>> x\n");
    expect(parsed.segments[0]).toMatchObject({ base: "b\n", ours: "a\n", theirs: "c\n" });
  });

  it("flags unterminated blocks as malformed", () => {
    const parsed = parseConflictMarkers("<<<<<<< HEAD\na\n=======\nb\n");
    expect(parsed.isMalformed).toBe(true);
    expect(hasConflictMarkers("<<<<<<< HEAD\na\n=======\nb\n")).toBe(true);
  });

  it("does not treat a lone ======= (markdown heading underline) as a conflict", () => {
    expect(hasConflictMarkers("Title\n=======\nbody\n")).toBe(false);
  });
});

describe("composeResolution", () => {
  const { segments } = parseConflictMarkers(CONFLICTED);
  it.each([
    ["ours", "head\nours line\ntail\n"],
    ["theirs", "head\ntheirs line\ntail\n"],
    ["both", "head\nours line\ntheirs line\ntail\n"],
  ] as const)("accepts %s", (choice, expected) => {
    expect(composeResolution(segments, { 0: choice })).toBe(expected);
  });

  it("keeps markers for unresolved blocks so they are still detected", () => {
    const text = composeResolution(segments, {});
    expect(text).toBe(CONFLICTED);
    expect(hasConflictMarkers(text)).toBe(true);
  });
});
