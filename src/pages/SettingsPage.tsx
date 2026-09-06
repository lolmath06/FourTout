import { useEffect, useState, type ReactNode } from "react";
import { toolRegistry } from "@/core/tools/registry";
import { useFavorites } from "@/features/favorites/store";
import { useRecents } from "@/features/recents/store";
import {
  useSettings,
  type DensityPreference,
  type MotionPreference,
  type ThemePreference,
} from "@/features/settings/store";
import { notify } from "@/features/notifications/store";
import { detectPlatform, isTauri } from "@/core/platform";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { formatZoom, stepZoom, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from "@/core/ui/zoom";
import { mediaCapabilities, type MediaCapabilities } from "@/core/media/capabilities";

const THEMES: { value: ThemePreference; label: string; icon: string }[] = [
  { value: "system", label: "Système", icon: "Monitor" },
  { value: "light", label: "Clair", icon: "Sun" },
  { value: "dark", label: "Sombre", icon: "Moon" },
];

const DENSITIES: { value: DensityPreference; label: string }[] = [
  { value: "compact", label: "Compacte" },
  { value: "comfortable", label: "Confortable" },
];

const MOTIONS: { value: MotionPreference; label: string }[] = [
  { value: "normal", label: "Normales" },
  { value: "reduced", label: "Réduites" },
];

/** Raccourcis réellement câblés dans l'application, et eux seuls. */
const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Ctrl  +", action: "Agrandir l'interface d'un cran (10 %)" },
  { keys: "Ctrl  −", action: "Réduire l'interface d'un cran (10 %)" },
  { keys: "Ctrl  0", action: "Revenir à 100 %" },
  { keys: "Ctrl  molette", action: "Ajuster l'interface au cran de 5 %" },
  { keys: "Échap", action: "Vider le champ de recherche ou de saisie courant" },
];

export function SettingsPage() {
  const theme = useSettings((state) => state.theme);
  const zoom = useSettings((state) => state.zoom);
  const density = useSettings((state) => state.density);
  const motion = useSettings((state) => state.motion);
  const showPrivacyNotes = useSettings((state) => state.showPrivacyNotes);
  const set = useSettings((state) => state.set);
  const resetAppearance = useSettings((state) => state.resetAppearance);
  const clearFavorites = useFavorites((state) => state.clear);
  const clearRecents = useRecents((state) => state.clear);
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <Page>
      <PageHeader
        icon="Settings"
        title="Paramètres"
        description="Apparence, moteurs et données locales."
      />

      <Section title="Apparence">
        <Row label="Thème" description="S'adapte par défaut au réglage de votre système.">
          <Segmented
            ariaLabel="Thème"
            value={theme}
            onChange={(value) => set("theme", value)}
            options={THEMES}
          />
        </Row>

        <Row
          label="Taille de l'interface"
          description="Agrandit toute l'application, comme le zoom d'un navigateur. Ctrl + / Ctrl − / Ctrl 0."
        >
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              aria-label="Réduire l'interface"
              onClick={() => set("zoom", stepZoom(zoom, -1))}
              disabled={zoom <= ZOOM_MIN}
            >
              <Icon name="Minus" size={14} />
            </Button>
            <span
              data-testid="zoom-value"
              className="ft-num w-14 text-center text-[13px] font-medium tabular-nums"
            >
              {formatZoom(zoom)}
            </span>
            <Button
              size="sm"
              aria-label="Agrandir l'interface"
              onClick={() => set("zoom", stepZoom(zoom, 1))}
              disabled={zoom >= ZOOM_MAX}
            >
              <Icon name="Plus" size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => set("zoom", ZOOM_DEFAULT)}
              disabled={zoom === ZOOM_DEFAULT}
            >
              Réinitialiser à 100 %
            </Button>
          </div>
        </Row>

        <Row
          label="Densité"
          description="« Confortable » relâche la hauteur des champs, des boutons et des listes."
        >
          <Segmented
            ariaLabel="Densité"
            value={density}
            onChange={(value) => set("density", value)}
            options={DENSITIES}
          />
        </Row>

        <Row
          label="Animations"
          description="« Réduites » supprime les transitions. Le réglage système est respecté dans tous les cas."
        >
          <Segmented
            ariaLabel="Animations"
            value={motion}
            onChange={(value) => set("motion", value)}
            options={MOTIONS}
          />
        </Row>

        <Row
          label="Rappel de confidentialité"
          description="Affiche « Traitement local » en pied des pages d'outil."
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
      </Section>

      <Section title="Raccourcis clavier">
        <div className="px-3 py-2">
          <table className="ft-table">
            <tbody>
              {SHORTCUTS.map((shortcut) => (
                <tr key={shortcut.keys}>
                  <td className="ft-value w-40 whitespace-nowrap text-[var(--ft-text)]">
                    {shortcut.keys}
                  </td>
                  <td className="text-[var(--ft-text-muted)]">{shortcut.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Moteurs et traitement">
        <MediaDiagnostics />
        <Row label="Catalogue" description="Ce que FourTout embarque.">
          <span className="ft-value text-[var(--ft-text-muted)]">
            {toolRegistry.all().length} outils · {toolRegistry.categories().length} catégories
          </span>
        </Row>
        <Row label="Environnement" description="Contexte d'exécution détecté.">
          <span className="ft-value text-[var(--ft-text-muted)]">
            {isTauri() ? `Application (${detectPlatform()})` : "Navigateur (développement)"}
          </span>
        </Row>
      </Section>

      <Section title="Données locales">
        <Row
          label="Préférences d'interface"
          description="Thème, taille, densité et animations. N'efface ni vos favoris, ni votre historique, ni les modèles installés."
        >
          {confirmingReset ? (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setConfirmingReset(false)}>
                Annuler
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  resetAppearance();
                  setConfirmingReset(false);
                  notify.success("Préférences d'interface réinitialisées");
                }}
              >
                Confirmer
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirmingReset(true)}>
              Réinitialiser les préférences d'interface
            </Button>
          )}
        </Row>

        <Row
          label="Favoris et historique"
          description="Stockés uniquement sur cet appareil."
        >
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
      </Section>

      <p className="mt-4 flex items-start gap-1.5 border-t border-[var(--ft-rule)] pt-3 text-[11.5px] text-[var(--ft-text-faint)]">
        <Icon name="ShieldCheck" size={13} className="mt-px shrink-0" />
        FourTout ne collecte aucune donnée et n'envoie rien sur Internet, à l'exception des taux de
        change du convertisseur de devises.
      </p>
    </Page>
  );
}

/** Panneau de réglages : un intitulé, un filet, des lignes. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4 overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
      <h2 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">{title}</h2>
      <div className="divide-y divide-[var(--ft-rule)]">{children}</div>
    </section>
  );
}

/** Groupe segmenté des réglages, aligné sur celui des outils. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; icon?: string }[];
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex h-[var(--ft-control)] w-fit items-stretch gap-px overflow-hidden rounded-[var(--radius-md)] border border-[var(--ft-border-strong)] bg-[var(--ft-border)]"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={
            value === option.value
              ? "flex items-center gap-1.5 bg-[var(--ft-surface-2)] px-2.5 text-xs font-medium text-[var(--ft-text)] shadow-[inset_0_-2px_0_var(--ft-accent)]"
              : "flex items-center gap-1.5 bg-[var(--ft-bg)] px-2.5 text-xs font-medium text-[var(--ft-text-muted)] hover:bg-[var(--ft-hover)] hover:text-[var(--ft-text)]"
          }
        >
          {option.icon && <Icon name={option.icon} size={13} />}
          {option.label}
        </button>
      ))}
    </div>
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

  if (!isTauri()) {
    return (
      <div className="px-3 py-2.5">
        <Callout tone="neutral" title="Moteurs indisponibles dans l'aperçu navigateur">
          FFmpeg, la parole locale et les outils Fichiers ne sont câblés que dans l'application
          installée.
        </Callout>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5">
      <p className="ft-label mb-1.5">Moteur média (FFmpeg)</p>
      {!caps ? (
        <p className="ft-meta flex items-center gap-2">
          <Icon name="Loader" size={13} className="animate-spin" /> Vérification des encodeurs…
        </p>
      ) : (
        <dl className="ft-props">
          <Info
            label="Encodeurs vidéo utilisables"
            value={caps.usableVideo.length > 0 ? caps.usableVideo.join(", ") : "aucun"}
          />
          <Info
            label="Annoncés mais inutilisables"
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
        <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-4 text-[var(--ft-text-faint)]">
          <Icon name="Info" size={12} className="mt-0.5 shrink-0" />
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
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-5">{label}</p>
        <p className="ft-meta">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="ft-value">{value}</dd>
    </>
  );
}
