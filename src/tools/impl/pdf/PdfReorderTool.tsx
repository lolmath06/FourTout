import { useEffect, useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { singleResult } from "@/components/pdf/result";
import { PageGrid } from "@/components/pdf/PageGrid";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { reorderPages } from "@/core/pdf/operations/pages";
import type { PdfSource } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";

export function PdfReorderTool({ tool }: ToolComponentProps) {
  const [order, setOrder] = useState<number[]>([]);

  return (
    <PdfToolShell
      tool={tool}
      actionLabel="Appliquer le nouvel ordre"
      actionDisabled={order.length === 0 || isIdentity(order)}
      run={async ({ documents, context }) => {
        const output = await reorderPages(documents[0].source, order, context);
        return singleResult(output, `${order.length} pages réorganisées.`);
      }}
    >
      {(documents) => (
        <ReorderBoard
          source={documents[0].source}
          pageCount={documents[0].info?.pageCount ?? 0}
          order={order}
          onOrder={setOrder}
        />
      )}
    </PdfToolShell>
  );
}

function ReorderBoard({
  source,
  pageCount,
  order,
  onOrder,
}: {
  source: PdfSource;
  pageCount: number;
  order: number[];
  onOrder: (order: number[]) => void;
}) {
  // Réinitialise dès qu'un autre document est déposé.
  useEffect(() => {
    onOrder(Array.from({ length: pageCount }, (_, index) => index + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.name, pageCount]);

  if (order.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-[var(--ft-text-muted)]">
          <Icon name="Info" size={13} />
          Faites glisser les pages pour les réordonner.
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => onOrder([...order].reverse())}>
            Inverser
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOrder(Array.from({ length: pageCount }, (_, i) => i + 1))}
            disabled={isIdentity(order)}
          >
            Réinitialiser
          </Button>
        </div>
      </div>

      <PageGrid source={source} pageCount={pageCount} order={order} onReorder={onOrder} />
    </div>
  );
}

function isIdentity(order: number[]): boolean {
  return order.every((page, index) => page === index + 1);
}
