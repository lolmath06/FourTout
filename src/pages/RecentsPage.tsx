import { Link } from "react-router-dom";
import { toolRegistry } from "@/core/tools/registry";
import { MAX_RECENTS, useRecents } from "@/features/recents/store";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { ToolRow } from "@/components/tools/ToolRow";

const relative = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

function formatWhen(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.5],
    ["month", 12],
  ];
  let value = seconds;
  for (const [unit, size] of units) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
    value /= size;
  }
  return relative.format(Math.round(value), "year");
}

export function RecentsPage() {
  const entries = useRecents((state) => state.entries);
  const clear = useRecents((state) => state.clear);

  return (
    <Page width="wide">
      <PageHeader
        icon="Clock3"
        title="Récents"
        description={`Les ${MAX_RECENTS} derniers outils ouverts, conservés entre deux sessions.`}
        actions={
          entries.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={clear}>
              Effacer l'historique
            </Button>
          ) : undefined
        }
      />

      {entries.length > 0 ? (
        <div className="grid gap-1.5 lg:grid-cols-2">
          {entries.map((entry) => {
            const tool = toolRegistry.get(entry.toolId);
            if (!tool) return null;
            return (
              <ToolRow
                key={entry.toolId}
                tool={tool}
                showCategory
                trailing={
                  <span className="hidden shrink-0 text-[11px] text-[var(--ft-text-faint)] sm:block">
                    {formatWhen(entry.openedAt)}
                  </span>
                }
              />
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon="Clock3"
          title="Aucun outil récent"
          description="Les outils que vous ouvrez apparaîtront ici automatiquement."
          action={
            <Link to="/tools">
              <Button size="sm" variant="primary">
                Parcourir les outils
              </Button>
            </Link>
          }
        />
      )}
    </Page>
  );
}
