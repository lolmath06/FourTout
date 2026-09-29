import { useCallback, useRef, useState } from "react";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PathPicker } from "@/components/files/PathPicker";
import { Panel, StatGrid, Warnings } from "@/components/files/Summary";
import { Field, Fieldset, NumberInput, TextInput } from "@/components/pdf/Field";
import { CheckOption } from "@/components/text/TextToolShell";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import {
  DEFAULT_SEARCH_QUERY,
  searchFiles,
  type SearchHit,
  type SearchReport,
} from "@/core/files/native";
import { revealFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Recherche de fichiers à la demande.
 *
 * Deux partis pris.
 *
 * **Les résultats arrivent pendant la recherche, pas après.** Le moteur natif
 * publie ses trouvailles par lots ; l'écran les affiche au fil de l'eau. Sur
 * une arborescence de cinquante mille fichiers, la différence entre « une barre
 * qui avance » et « des résultats qui tombent » est la différence entre un
 * outil qu'on attend et un outil qu'on utilise.
 *
 * **Aucun index.** Rien ne tourne en fond, rien n'est conservé entre deux
 * recherches, aucun fichier caché ne grossit dans le dossier personnel.
 */
function parseSize(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^([\d.,]+)\s*(o|ko|mo|go|kb|mb|gb)?$/i.exec(trimmed);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] ?? "o").toLowerCase();
  const factor =
    unit === "ko" || unit === "kb"
      ? 1024
      : unit === "mo" || unit === "mb"
        ? 1024 ** 2
        : unit === "go" || unit === "gb"
          ? 1024 ** 3
          : 1;
  return Math.round(amount * factor);
}

function parseDate(value: string): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export function FileSearchTool(_props: ToolComponentProps) {
  const [root, setRoot] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [extensions, setExtensions] = useState("");
  const [content, setContent] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [minSize, setMinSize] = useState("");
  const [maxSize, setMaxSize] = useState("");
  /**
   * Le filtre de date est **désactivé** tant qu'on ne l'allume pas.
   *
   * Un champ de type « date » affiche « jj/mm/aaaa » au repos : à l'écran, il
   * ressemble à un filtre déjà en place. Une case à cocher lève l'ambiguïté —
   * tant qu'elle est vide, aucune borne de date n'entre dans la requête.
   */
  const [filterByDate, setFilterByDate] = useState(false);
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [maxResults, setMaxResults] = useState(5000);

  /** Résultats affichés pendant la recherche, avant le rapport final. */
  const [live, setLive] = useState<SearchHit[]>([]);
  const liveRef = useRef<SearchHit[]>([]);
  const action = useNativeAction<SearchReport>();
  /**
   * Empreinte des critères au moment où la recherche a été lancée.
   *
   * Elle sert à répondre à une question que l'utilisateur se pose forcément en
   * modifiant un champ : « ce que je vois correspond-il encore à ce que je
   * lis ? » Sans elle, des résultats périmés passent pour actuels.
   */
  const [searchedWith, setSearchedWith] = useState<string | null>(null);

  const onBatch = useCallback((hits: SearchHit[]) => {
    liveRef.current = [...liveRef.current, ...hits];
    setLive(liveRef.current);
  }, []);

  if (!isNativeAvailable()) return <NativeRequired />;

  const report = action.result;
  const hits = report ? report.hits : live;
  const criteria = JSON.stringify({
    root: root[0] ?? "",
    name: name.trim(),
    extensions: extensions.trim(),
    content,
    caseSensitive,
    wholeWord,
    minSize: minSize.trim(),
    maxSize: maxSize.trim(),
    after: filterByDate ? after : "",
    before: filterByDate ? before : "",
    recursive,
    includeHidden,
    maxResults,
  });
  const stale = searchedWith !== null && searchedWith !== criteria;
  const hasCriteria =
    name.trim().length > 0 ||
    extensions.trim().length > 0 ||
    content.length > 0 ||
    minSize.trim().length > 0 ||
    maxSize.trim().length > 0 ||
    (filterByDate && (after.length > 0 || before.length > 0));

  const run = () => {
    liveRef.current = [];
    setLive([]);
    setSearchedWith(criteria);
    void action.execute((context) =>
      searchFiles(
        {
          ...DEFAULT_SEARCH_QUERY,
          root: root[0],
          name: name.trim(),
          extensions: extensions
            .split(/[,\s]+/)
            .map((entry) => entry.trim().replace(/^\./, ""))
            .filter(Boolean),
          content,
          caseSensitive,
          wholeWord,
          minSize: parseSize(minSize),
          maxSize: parseSize(maxSize),
          modifiedAfter: filterByDate ? parseDate(after) : null,
          modifiedBefore: filterByDate ? parseDate(before) : null,
          walk: { recursive, includeHidden, symlinks: "report" },
          maxResults: maxResults > 0 ? maxResults : null,
        },
        context,
        onBatch,
      ),
    );
  };

  return (
    <div className="space-y-4">
      <PathPicker
        mode="directory"
        paths={root}
        onChange={(next) => {
          setRoot(next);
          action.setResult(null);
        }}
        label="Dossier où chercher"
        hint="rien n'est indexé : la recherche part d'ici, à chaque fois"
        disabled={action.job.isRunning}
      />

      {root.length > 0 && (
        <>
          <Fieldset columns={2} title="Nom et type">
            <Field label="Le nom contient" hint="Insensible à la casse et aux accents du clavier.">
              <TextInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="facture"
                aria-label="Le nom contient"
              />
            </Field>
            <Field label="Extensions" hint="Séparées par des espaces ou des virgules : txt md json">
              <TextInput
                value={extensions}
                onChange={(event) => setExtensions(event.target.value)}
                placeholder="txt, pdf"
                aria-label="Extensions"
              />
            </Field>
          </Fieldset>

          <Fieldset columns={2} title="Contenu">
            <Field
              label="Le fichier contient le texte"
              hint="Seuls les fichiers qui ressemblent vraiment à du texte sont ouverts. L'encodage est détecté (UTF-8, UTF-16, Windows-1252…)."
              full
            >
              <TextInput
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="FourTout"
                aria-label="Le fichier contient le texte"
              />
            </Field>
            <Field label="Options de recherche">
              <div className="space-y-0.5">
                <CheckOption
                  checked={caseSensitive}
                  onChange={setCaseSensitive}
                  label="Respecter la casse"
                  disabled={content.length === 0}
                />
                <CheckOption
                  checked={wholeWord}
                  onChange={setWholeWord}
                  label="Mot entier"
                  disabled={content.length === 0}
                />
              </div>
            </Field>
          </Fieldset>

          <Fieldset columns={2} title="Taille et date">
            <Field label="Taille minimale" hint="Exemples : 500 ko, 2 Mo, 1,5 Go">
              <TextInput
                value={minSize}
                onChange={(event) => setMinSize(event.target.value)}
                placeholder="—"
                aria-label="Taille minimale"
              />
            </Field>
            <Field label="Taille maximale">
              <TextInput
                value={maxSize}
                onChange={(event) => setMaxSize(event.target.value)}
                placeholder="—"
                aria-label="Taille maximale"
              />
            </Field>
            <Field label="Filtrer par date de modification" full>
              <CheckOption
                checked={filterByDate}
                onChange={(next) => {
                  setFilterByDate(next);
                  if (!next) {
                    setAfter("");
                    setBefore("");
                  }
                }}
                label="Limiter à une période"
                hint="Désactivé : la date des fichiers n'entre pas dans la recherche."
              />
            </Field>
            <Field label="Modifié après le" hint={filterByDate ? undefined : "Activez le filtre ci-dessus."}>
              <TextInput
                type="date"
                value={after}
                disabled={!filterByDate}
                onChange={(event) => setAfter(event.target.value)}
                aria-label="Modifié après le"
              />
            </Field>
            <Field label="Modifié avant le">
              <TextInput
                type="date"
                value={before}
                disabled={!filterByDate}
                onChange={(event) => setBefore(event.target.value)}
                aria-label="Modifié avant le"
              />
            </Field>
          </Fieldset>

          <Fieldset columns={2} title="Parcours">
            <Field label="Sous-dossiers">
              <div className="space-y-0.5">
                <CheckOption
                  checked={recursive}
                  onChange={setRecursive}
                  label="Descendre dans les sous-dossiers"
                />
                <CheckOption
                  checked={includeHidden}
                  onChange={setIncludeHidden}
                  label="Inclure les fichiers cachés"
                />
              </div>
            </Field>
            <Field
              label="Nombre maximal de résultats"
              hint="Garde-fou : au-delà, la recherche s'arrête et le dit."
            >
              <NumberInput
                min={1}
                max={100000}
                value={maxResults}
                onChange={(event) => setMaxResults(Number(event.target.value))}
                aria-label="Nombre maximal de résultats"
              />
            </Field>
          </Fieldset>

          {!hasCriteria && (
            <Callout tone="info" title="Aucun critère : tous les fichiers seront listés">
              Renseignez au moins un critère pour affiner — ils se cumulent tous.
            </Callout>
          )}

          <RunBar
            label="Rechercher"
            icon="SearchCode"
            running={action.job.isRunning}
            progress={action.job.progress}
            status={action.job.status}
            error={action.error}
            cancel={action.job.cancel}
            onRun={run}
          />
        </>
      )}

      {(hits.length > 0 || report) && (
        <div className="space-y-3" data-testid="search-results">
          {stale && !action.job.isRunning && (
            <Callout
              tone="warning"
              title="Les critères ont changé — relancez la recherche"
              data-testid="search-stale"
            >
              Les résultats ci-dessous viennent de la requête précédente. Ils ne correspondent plus
              à ce que les champs affichent.
            </Callout>
          )}
          {report && (
            <StatGrid
              columns={5}
              stats={[
                { label: "Résultats", value: report.hits.length, tone: report.hits.length > 0 ? "ok" : "neutral" },
                { label: "Dossiers parcourus", value: report.scannedDirectories },
                { label: "Fichiers inspectés", value: report.scannedFiles },
                { label: "Fichiers lus", value: report.readFiles },
                { label: "Binaires ignorés", value: report.binarySkipped },
              ]}
            />
          )}

          {report?.truncated && (
            <Callout tone="warning" title="Limite de résultats atteinte">
              La recherche s'est arrêtée à {report.hits.length.toLocaleString("fr-FR")} résultats.
              Affinez les critères, ou augmentez la limite.
            </Callout>
          )}
          {report && report.tooLarge > 0 && (
            <Callout tone="info" title={`${report.tooLarge} fichier(s) trop volumineux`}>
              Au-delà de 64 Mo, un fichier n'est pas ouvert pour la recherche de contenu. Il reste
              trouvable par son nom, sa taille ou sa date.
            </Callout>
          )}

          <Panel
            title={
              action.job.isRunning
                ? "Résultats (recherche en cours…)"
                : stale
                  ? "Résultats de la recherche précédente"
                  : "Résultats"
            }
            count={hits.length}
            testId="search-hits"
          >
            <ul className="max-h-[32rem] divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
              {hits.slice(0, 1000).map((hit) => (
                <li key={hit.path} className="flex items-start gap-2 px-3 py-1.5">
                  <span className="mt-0.5 shrink-0 text-[var(--ft-text-faint)]">
                    <Icon name="File" size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{hit.name}</span>
                    <span
                      className="block truncate font-mono text-[11px] text-[var(--ft-text-faint)]"
                      title={hit.path}
                    >
                      {hit.relative}
                    </span>
                    <span className="block text-[11px] text-[var(--ft-text-muted)]">
                      {hit.reason}
                      {hit.encoding && ` · ${hit.encoding}`}
                    </span>
                    {hit.excerpt && (
                      <span className="mt-0.5 block truncate rounded bg-[var(--ft-surface-2)] px-1.5 py-0.5 font-mono text-[11px]">
                        {hit.excerpt}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--ft-text-muted)]">
                    {formatFileSize(hit.size)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Ouvrir l'emplacement de ${hit.name}`}
                    onClick={() => revealFile(hit.path)}
                  >
                    <Icon name="FolderTree" size={13} />
                  </Button>
                </li>
              ))}
              {hits.length === 0 && !action.job.isRunning && (
                <li className="px-3 py-2 text-[var(--ft-text-faint)]">
                  Aucun fichier ne correspond à ces critères.
                </li>
              )}
              {hits.length > 1000 && (
                <li className="px-3 py-1 text-[var(--ft-text-faint)]">
                  … et {(hits.length - 1000).toLocaleString("fr-FR")} de plus
                </li>
              )}
            </ul>
          </Panel>

          {report && <Warnings title="Avertissements" items={report.warnings} />}
        </div>
      )}
    </div>
  );
}
