import type { ApiErrorPayload, ErrorKind } from "@/lib/types";
import { redact } from "./redact";

/** Any failure raised by the backend that should be shown to the user as-is. */
export class GitError extends Error {
  readonly kind: ErrorKind;
  readonly output: string;
  readonly suggestions: string[];
  readonly status: number;

  constructor(kind: ErrorKind, message: string, options: { output?: string; suggestions?: string[]; status?: number } = {}) {
    super(message);
    this.name = "GitError";
    this.kind = kind;
    this.output = redact(options.output ?? "");
    this.suggestions = options.suggestions ?? [];
    this.status = options.status ?? 400;
  }
}

interface Rule {
  kind: ErrorKind;
  pattern: RegExp;
  explanation: string;
  suggestions: string[];
}

// Ordered: the first matching rule wins.
const RULES: Rule[] = [
  {
    kind: "unsafe-directory",
    pattern: /detected dubious ownership|safe\.directory/i,
    explanation: "Git refuses to work in a folder owned by another user.",
    suggestions: ["If you trust this folder, run: git config --global --add safe.directory <path>"],
  },
  {
    kind: "not-a-repository",
    pattern: /not a git repository/i,
    explanation: "This folder is not a Git repository (or its .git directory is damaged).",
    suggestions: ["Pick the folder that contains the .git directory.", "Remove the repository from the app if it was deleted."],
  },
  {
    kind: "auth-failed",
    pattern: /authentication failed|permission denied \(publickey|could not read (username|password)|terminal prompts disabled|invalid username or password|access denied|HTTP 40[13]|remote: (invalid|repository not found)|publickey/i,
    explanation: "The remote rejected your credentials, or none were available. This app never prompts for or stores passwords.",
    suggestions: [
      "Configure a Git credential helper (e.g. `git config --global credential.helper store` or your OS keychain) or an SSH key with ssh-agent.",
      "Verify the remote URL and that your account has access.",
    ],
  },
  {
    kind: "non-fast-forward",
    pattern: /non-fast-forward|\[rejected\]|failed to push some refs|fetch first|tip of your current branch is behind|not possible to fast-forward|diverging branches|divergent branches/i,
    explanation:
      "The local and remote branches have diverged: the remote has commits you do not have, so Git will not overwrite or fast-forward either side automatically.",
    suggestions: [
      "Fetch, then pull with “merge” or “rebase” to combine the histories, and push again.",
      "Force pushing (with lease) would discard the remote commits — only do this if you are certain.",
    ],
  },
  {
    kind: "network",
    pattern: /could not resolve host|unable to access|connection (timed out|refused|reset)|network is unreachable|early EOF|the remote end hung up|Could not read from remote|failed to connect/i,
    explanation: "Git could not reach the remote server.",
    suggestions: ["Check your internet connection, VPN or proxy.", "Verify the remote URL in the Remotes view."],
  },
  {
    kind: "no-remote",
    pattern: /no such remote|does not appear to be a git repository|no remote repository specified|remote .* already exists/i,
    explanation: "The remote does not exist, or is not a valid Git repository.",
    suggestions: ["Open Remotes and add or correct the remote URL."],
  },
  {
    kind: "no-upstream",
    pattern: /no upstream|no tracking information|has no upstream branch|no configured push destination/i,
    explanation: "The current branch is not tracking any remote branch.",
    suggestions: ["Push with “set upstream” enabled, or set the upstream in Branches."],
  },
  {
    kind: "merge-conflict",
    pattern: /conflict|automatic merge failed|could not apply|fix conflicts/i,
    explanation: "Git could not combine the changes automatically.",
    suggestions: ["Open the conflict resolver, fix every file, then continue — or abort to return to the previous state."],
  },
  {
    kind: "dirty-worktree",
    pattern: /would be overwritten|your local changes|please commit your changes or stash|unstaged changes|uncommitted changes|index contains uncommitted/i,
    explanation: "Uncommitted changes would be overwritten by this operation.",
    suggestions: ["Commit or stash your changes first (Source Control / Stash)."],
  },
  {
    kind: "identity-missing",
    pattern: /please tell me who you are|unable to auto-detect email address|empty ident name/i,
    explanation: "Git does not know your name and email, which are required to create commits.",
    suggestions: ['Run: git config --global user.name "Your Name" and git config --global user.email you@example.com'],
  },
  {
    kind: "not-fully-merged",
    pattern: /not fully merged/i,
    explanation: "The branch contains commits that are not part of the current branch; deleting it could lose them.",
    suggestions: ["Merge the branch first, or choose “force delete” if you are sure the commits are not needed."],
  },
  {
    kind: "ref-exists",
    pattern: /already exists|already used by worktree/i,
    explanation: "A branch, tag or remote with that name already exists.",
    suggestions: ["Choose a different name."],
  },
  {
    kind: "ref-not-found",
    pattern: /unknown revision|bad revision|not a valid object name|did not match any|couldn't find remote ref|pathspec .* did not match|no such (branch|tag)|not a commit|invalid reference/i,
    explanation: "The branch, tag or commit could not be found.",
    suggestions: ["Refresh the repository and try again."],
  },
  {
    kind: "locked",
    pattern: /index\.lock|unable to create '.*\.lock'|another git process/i,
    explanation: "Another Git process is running in this repository, or a previous one crashed and left a lock file.",
    suggestions: ["Wait for the other Git process to finish.", "If none is running, delete the stale .git/index.lock file."],
  },
];

export function describeError(error: unknown): ApiErrorPayload & { status: number } {
  if (error instanceof GitError) {
    const rule = RULES.find((entry) => entry.kind === error.kind);
    return {
      kind: error.kind,
      message: error.message,
      explanation: rule?.explanation ?? error.message,
      suggestions: error.suggestions.length > 0 ? error.suggestions : (rule?.suggestions ?? []),
      output: error.output || undefined,
      status: error.status,
    };
  }
  const raw = error instanceof Error ? error.message : String(error);
  return {
    kind: "unknown",
    message: redact(raw),
    explanation: "An unexpected error occurred in the local Git backend.",
    suggestions: ["Refresh and try again. See Diagnostics for details."],
    status: 500,
  };
}

/** Maps raw Git stderr to a typed GitError with an explanation and recovery steps. */
export function classifyGitFailure(stderr: string, stdout: string, fallbackMessage: string): GitError {
  const combined = `${stderr}\n${stdout}`;
  const rule = RULES.find((entry) => entry.pattern.test(combined));
  const message = redact(firstMeaningfulLine(stderr) || firstMeaningfulLine(stdout) || fallbackMessage);
  return new GitError(rule?.kind ?? "unknown", message, { output: combined.trim(), suggestions: rule?.suggestions });
}

function firstMeaningfulLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
}
