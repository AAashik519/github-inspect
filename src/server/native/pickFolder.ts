import { execFile } from "node:child_process";
import os from "node:os";
import { GitError } from "../git/errors";

type Picker = { command: string; args: string[] };

function pickersForPlatform(): Picker[] {
  switch (process.platform) {
    case "darwin":
      return [{ command: "osascript", args: ["-e", 'POSIX path of (choose folder with prompt "Select a Git repository folder")'] }];
    case "win32":
      return [
        {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }",
          ],
        },
      ];
    default:
      return [
        { command: "zenity", args: ["--file-selection", "--directory", "--title=Select a Git repository folder"] },
        { command: "kdialog", args: ["--getexistingdirectory", os.homedir()] },
      ];
  }
}

function runPicker({ command, args }: Picker): Promise<{ path: string | null } | "unavailable"> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5 * 60_000 }, (error, stdout) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") return resolve("unavailable");
      // Dialogs exit non-zero when cancelled.
      if (error && !stdout.trim()) return error.killed ? reject(error) : resolve({ path: null });
      resolve({ path: stdout.trim().replace(/\/$/, "") || null });
    });
  });
}

/** Opens the operating system's folder dialog on the machine running this backend. */
export async function pickFolder(): Promise<string | null> {
  for (const picker of pickersForPlatform()) {
    const result = await runPicker(picker);
    if (result !== "unavailable") return result.path;
  }
  throw new GitError("precondition", "No native folder picker is available on this system.", {
    suggestions: ["Type the repository path manually (for example /home/you/projects/app)."],
  });
}
