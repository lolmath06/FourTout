import { useEffect, useState } from "react";
import { toolRegistry } from "@/core/tools/registry";
import { useFavorites } from "@/features/favorites/store";
import { useRecents } from "@/features/recents/store";
import { useSettings, type ThemePreference } from "@/features/settings/store";
import { notify } from "@/features/notifications/store";
import { detectPlatform, isTauri } from "@/core/platform";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { mediaCapabilities, type MediaCapabilities } from "@/core/media/capabilities";

const THEMES: { value: ThemePreference; label: string; icon: string }[] = [
  { value: "system", label: "Système", icon: "Monitor" },
  { value: "light", label: "Clair", icon: "Sun" },
  { value: "dark", label: "Sombre", icon: "Moon" },
];

export function SettingsPage() {
  const theme = useSettings((state) => state.theme);
  const showPrivacyNotes = useSettings((state) => state.showPrivacyNotes);
  const set = useSettings((state) => state.set);
  const clearFavorites = useFavorites((state) => state.clear);
  const clearRecents = useRecents((state) => state.clear);

  return (
    <Page>
      <PageHeader icon="Settings" title="Paramètres" description="Apparence et données locales." />

      <div className="space-y-2">
        <Row label="Thème" description="S'adapte par défaut au réglage de votre système.">
          <div className="flex h-8 items-center gap-0.5 rounded-lg border border-[var(--ft-border)] bg-[var(--ft-surface)] p-0.5">
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={theme === option.value}
                onClick={() => set("theme", option.value)}
                className={
                  theme === option.value
                    ? "flex items-center gap-1.5 rounded-md bg-[var(--ft-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--ft-accent-text)]"
                    : "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-[var(--ft-text-muted)] hover:text-[var(--ft-text)]"
                }
              >
                <Icon name={option.icon} size={13} />
                {option.label}
              </button>
            ))}
          </div>
        </Row>

        <Row
          label="Rappel de confidentialité"
          description="Affiche « Traitement local » sur les pages d'outil."
        >
          <label className="flex items-center gap-2 text-xs text-[var(--ft-text-muted)]">
            <input
              type="checkbox"
              checked={showPrivacyNotes}
              onChange={(event) => set("showPrivacyNotes", event.target.checked)}
            />
            Activé
          </label>
        </Row>

        <Row label="Données locales" description="Favoris et historique sont stockés sur cet appareil.">
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                clearFavorites();
                notify.info("Favoris effacés");
              }}
            >
              Effacer les favoris
            </Button>
            <Button
              size="sm"
              onClick={() => {
                clearRecents();
                notify.info("Historique effacé");
              }}
            >
              Effacer les récents
            </Button>
          </div>
        </Row>
      </div>

      <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ft-text-muted)]">
          À propos
        </h2>
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <Info label="Catalogue" value={`${toolRegistry.all().length} outils`} />
          <Info label="Disponibles" value={`${toolRegistry.withStatus("available").length} outils`} />
          <Info label="Catégories" value={`${toolRegistry.categories().length}`} />
          <Info label="Environnement" value={isTauri() ? `Application (${detectPlatform()})` : "Navigateur (développement)"} />
        </dl>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--ft-text-faint)]">
          <Icon name="ShieldCheck" size={13} />
          FourTout ne collecte aucune donnée et n'envoie rien sur Internet, à l'exception des taux
          de change du convertisseur de devises.
        </p>
      </div>

      <MediaDiagnostics />
    </Page>
  );
}

/**
 * Ce que le moteur média sait réellement faire **sur cette machine**.
 *
 * Les encodeurs écartés sont affichés explicitement : sans cela, un utilisateur
 * dont FFmpeg annonce `h264_nvenc` sans pouvoir l'ouvrir n'a aucun moyen de
 * comprendre pourquoi FourTout n'utilise pas sa carte graphique.
 */
function MediaDiagnostics() {
  const [caps, setCaps] = useState<MediaCapabilities | undefined>(undefined);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void mediaCapabilities().then((result) => {
      if (!cancelled) setCaps(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isTauri()) return null;

  return (
    <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ft-text-muted)]">
        Moteur média
      </h2>
      {!caps ? (
        <p className="flex items-center gap-2 text-xs text-[var(--ft-text-muted)]">
          <Icon name="Loader" size={13} className="animate-spin" /> Vérification des encodeurs…
        </p>
      ) : (
        <dl className="grid gap-x-6 gap-y-1 text-xs">
          <Info
            label="Encodeurs vidéo utilisables"
            value={caps.usableVideo.length > 0 ? caps.usableVideo.join(", ") : "aucun"}
          />
          <Info
            label="Annoncés mais inutilisables ici"
            value={caps.rejectedVideo.length > 0 ? caps.rejectedVideo.join(", ") : "aucun"}
          />
          <Info
            label="Sous-titres en piste"
            value={
              caps.subtitleContainers.length > 0
                ? caps.subtitleContainers.map((c) => c.toUpperCase()).join(", ")
                : "aucun conteneur"
            }
          />
        </dl>
      )}
      {caps && caps.rejectedVideo.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-[var(--ft-text-faint)]">
          <Icon name="Info" size={13} className="mt-px shrink-0" />
          Ces encodeurs sont compilés dans FFmpeg mais n'ont pas réussi à encoder une image sur
          cette machine (matériel absent, pilote incompatible, périphérique inaccessible). FourTout
          ne les propose donc pas.
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-[var(--ft-text-muted)]">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--ft-border)] py-1 last:border-0">
      <dt className="text-[var(--ft-text-muted)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
