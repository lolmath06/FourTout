import { Link } from "react-router-dom";
import { Page } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";

export function NotFoundPage() {
  return (
    <Page>
      <EmptyState
        icon="CircleDashed"
        title={t("Page introuvable")}
        description={t("Cette page n'existe pas dans FourTout.")}
        action={
          <Link to="/">
            <Button size="sm" variant="primary">
              {t("Retour à l'accueil")}
            </Button>
          </Link>
        }
      />
    </Page>
  );
}
