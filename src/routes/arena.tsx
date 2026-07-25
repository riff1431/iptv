import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ArenaTopNav } from "@/components/sports-arena/ArenaTopNav";
import { ArenaBottomTabs } from "@/components/sports-arena/ArenaBottomTabs";

export const Route = createFileRoute("/arena")({
  component: ArenaLayout,
});

function ArenaLayout() {
  return (
    <div className="min-h-screen bg-arena text-white">
      <ArenaTopNav />
      <Outlet />
      <ArenaBottomTabs />
    </div>
  );
}
