import { Link } from "react-router-dom";
import { Page } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

export function NotFoundPage() {
  return (
    <Page>
      <EmptyState
        icon="CircleDashed"
        title="Page introuvable"
        description="Cette page n'existe pas dans FourTout."
        action={
          <Link to="/">
            <Button size="sm" variant="primary">
              Retour à l'accueil
            </Button>
          </Link>
        }
      />
    </Page>
  );
}
