import { WorkspaceShell } from "@/components/layout/WorkspaceShell";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";

export default function HomePage() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}
