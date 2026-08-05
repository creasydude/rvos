"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Chat, { RoleStatus } from "@/components/Chat";

// useSearchParams must be under Suspense so the page still statically renders.
export default function Page() {
  return (
    <Suspense fallback={<Shell loading />}>
      <PageInner />
    </Suspense>
  );
}

function Shell({ loading }: { loading?: boolean }) {
  return (
    <div className="flex h-full">
      {loading && <div className="h-full w-64 animate-pulse border-r border-border bg-surface" />}
      <div className="flex-1" />
    </div>
  );
}

function PageInner() {
  const searchParams = useSearchParams();
  const [roles, setRoles] = useState<RoleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialAnalysis, setInitialAnalysis] = useState<string | undefined>();

  useEffect(() => {
    fetch("/api/roles")
      .then((r) => r.json())
      .then((d) =>
        setRoles({
          fundamental: !!d.fundamental,
          technical: !!d.technical,
          synthesis: !!d.synthesis,
        }),
      )
      .catch(() => setRoles({ fundamental: false, technical: false, synthesis: false }))
      .finally(() => setLoading(false));
  }, []);

  // Refresh roles when returning to the page (after Settings changes).
  useEffect(() => {
    const onFocus = () => {
      fetch("/api/roles")
        .then((r) => r.json())
        .then((d) =>
          setRoles({ fundamental: !!d.fundamental, technical: !!d.technical, synthesis: !!d.synthesis }),
        )
        .catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Load a saved analysis by id (from sidebar history). useSearchParams
  // updates on client-side navigation, so clicking a history item re-triggers
  // this effect without a manual refresh.
  const analysisId = searchParams.get("id");
  useEffect(() => {
    if (!analysisId) {
      setInitialAnalysis(undefined);
      return;
    }
    fetch(`/api/analyses?id=${analysisId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.body && d.kind === "analysis") setInitialAnalysis(d.body);
        else setInitialAnalysis(undefined);
      })
      .catch(() => setInitialAnalysis(undefined));
  }, [analysisId]);

  if (loading) return <Shell loading />;

  return (
    <div className="flex h-full">
      <Sidebar />
      {/* `key` forces Chat to remount when navigating between analyses, so its
          message thread reseeds with the selected analysis instead of carrying
          stale bubbles from a previous selection. */}
      <Chat
        key={analysisId ?? "new"}
        roles={roles ?? { fundamental: false, technical: false, synthesis: false }}
        initialAnalysis={initialAnalysis}
      />
    </div>
  );
}
