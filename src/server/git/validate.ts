// Input validation at the trust boundary. Every value that reaches a git argument passes through here.

import path from "node:path";
import { GitError } from "./errors";
import { runGit } from "./run";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SHA_PATTERN = /^[0-9a-f]{4,64}$/i;
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const STASH_REF = /^stash@\{(\d{1,5})\}$/;
const MAX_TEXT = 100_000;

export function invalid(message: string): GitError {
  return new GitError("validation", message);
}

export function requireString(value: unknown, field: string, maxLength = 4096): string {
  if (typeof value !== "string" || value.length === 0) throw invalid(`“${field}” is required.`);
  if (value.length > maxLength || value.includes("\u0000")) throw invalid(`“${field}” is invalid.`);
  return value;
}

export function optionalString(value: unknown, field: string, maxLength = MAX_TEXT): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, field, maxLength);
}

export function optionalBoolean(value: unknown): boolean {
  return value === true;
}

export function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw invalid(`“${field}” must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

export function optionalInteger(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(`“${field}” must be an integer between ${min} and ${max}.`);
  }
  return value;
}

/** A commit hash or ref name. Rejects option-looking and revision-expression syntax. */
export function requireRevision(value: unknown, field: string): string {
  const revision = requireString(value, field, 256);
  if (revision.startsWith("-") || CONTROL_CHARACTERS.test(revision) || /[\s~^:?*[\\]|\.\./.test(revision)) {
    throw invalid(`“${field}” is not a valid branch, tag or commit name.`);
  }
  return revision;
}

export function isFullHash(value: string): boolean {
  return SHA_PATTERN.test(value);
}

export async function assertBranchName(name: unknown, field = "branch name"): Promise<string> {
  const value = requireString(name, field, 244);
  if (value.startsWith("-") || CONTROL_CHARACTERS.test(value)) throw invalid(`“${value}” is not a valid ${field}.`);
  const { code } = await runGit(["check-ref-format", "--branch", value], { okCodes: [0, 1, 128] });
  if (code !== 0) throw invalid(`“${value}” is not a valid ${field}. Git forbids spaces, “..”, “~”, “^”, “:”, “?”, “*”, “[” and trailing “.lock”.`);
  return value;
}

export async function assertTagName(name: unknown): Promise<string> {
  const value = requireString(name, "tag name", 244);
  if (value.startsWith("-") || CONTROL_CHARACTERS.test(value)) throw invalid(`“${value}” is not a valid tag name.`);
  const { code } = await runGit(["check-ref-format", `refs/tags/${value}`], { okCodes: [0, 1, 128] });
  if (code !== 0) throw invalid(`“${value}” is not a valid tag name.`);
  return value;
}

export function assertRemoteName(name: unknown): string {
  const value = requireString(name, "remote name", 100);
  if (!REMOTE_NAME.test(value)) throw invalid("Remote names may contain letters, digits, “.”, “_” and “-” and must start with a letter or digit.");
  return value;
}

const SAFE_URL_SCHEMES = /^(https?|ssh|git|file):\/\/[^\s]+$/i;
const SCP_LIKE_URL = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/;

/** Accepts common remote forms and rejects option injection and command-running transports (`ext::`). */
export function assertRemoteUrl(url: unknown): string {
  const value = requireString(url, "remote URL", 2048).trim();
  if (value.startsWith("-") || CONTROL_CHARACTERS.test(value)) throw invalid("The remote URL is invalid.");
  const isLocalPath = path.isAbsolute(value) && !value.includes("::");
  if (!SAFE_URL_SCHEMES.test(value) && !SCP_LIKE_URL.test(value) && !isLocalPath) {
    throw invalid("Use an https://, ssh://, git:// or file:// URL, an SSH address like git@host:owner/repo.git, or an absolute local path.");
  }
  return value;
}

export function assertStashRef(ref: unknown): { ref: string; index: number } {
  const value = requireString(ref, "stash", 32);
  const match = STASH_REF.exec(value);
  if (!match) throw invalid("Invalid stash reference.");
  return { ref: value, index: Number(match[1]) };
}

/** A repository-relative path: no absolute paths, no `..`, no option-looking names. */
export function assertRelativePath(value: unknown, field = "path"): string {
  const filePath = requireString(value, field, 4096);
  const segments = filePath.split(/[\\/]/);
  if (path.isAbsolute(filePath) || /^[A-Za-z]:/.test(filePath) || segments.includes("..") || filePath.startsWith("-") || CONTROL_CHARACTERS.test(filePath)) {
    throw invalid(`“${field}” must be a path inside the repository.`);
  }
  return filePath;
}

export function assertPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5000) throw invalid("Select between 1 and 5000 files.");
  return value.map((entry) => assertRelativePath(entry));
}

export function assertCommitMessage(value: unknown): string {
  const message = requireString(value, "commit message", MAX_TEXT).trim();
  if (message.length === 0) throw invalid("The commit message cannot be empty.");
  return message;
}
