import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/arena")({
  component: ArenaLayout,
});

function ArenaLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
