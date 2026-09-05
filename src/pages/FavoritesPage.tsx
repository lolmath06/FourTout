import { Link } from "react-router-dom";
import { toolRegistry } from "@/core/tools/registry";
import { useFavorites } from "@/features/favorites/store";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { ToolList } from "@/components/tools/ToolRow";

export function FavoritesPage() {
  const ids = useFavorites((state) => state.ids);
  const clear = useFavorites((state) => state.clear);
  const tools = toolRegistry.resolveMany(ids);

  return (
    <Page width="wide">
      <PageHeader
        icon="Star"
        title="Favoris"
        description="Les outils que vous épinglez restent ici, même après redémarrage."
        actions={
          tools.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={clear}>
              Tout retirer
            </Button>
          ) : undefined
        }
      />

      {tools.length > 0 ? (
        <ToolList tools={tools} showCategory />
      ) : (
        <EmptyState
          icon="Star"
          title="Aucun favori pour l'instant"
          description="Cliquez sur l'étoile d'un outil pour le retrouver ici en un clic."
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
