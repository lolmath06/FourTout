import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, OptionGroup, Select } from "@/components/pdf/Field";
import { PathPicker } from "@/components/files/PathPicker";
import { TextPane } from "@/components/text/TextToolShell";
import { baseName } from "@/core/files/paths";
import { saveFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import { isTauri } from "@/core/platform";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import {
  browseTable,
  cellDetail,
  cellText,
  DEFAULT_ROW_LIMIT,
  formatBytes,
  openDatabase,
  queryToCsv,
  runQuery,
  SQLITE_NATIVE_REQUIRED,
  SQLITE_READ_ONLY_NOTE,
  type DatabaseOverview,
  type ObjectInfo,
  type QueryResult,
} from "@/core/sqlite/native";
import type { ToolComponentProps } from "@/tools/implementations";

type Pane = "data" | "schema" | "query";

const ROW_LIMITS = [100, 500, 1000, 5000];

/** Tableau de résultats. Un BLOB y est nommé, jamais rendu comme du texte. */
function ResultTable({ result }: { result: QueryResult }) {
  if (result.columns.length === 0) {
    return <Callout tone="info">Cette requête ne renvoie aucune colonne.</Callout>;
  }
  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
      <div className="max-h-[28rem] overflow-auto">
        <table className="ft-table">
          <thead>
            <tr>
              {result.columns.map((column, index) => (
                <th key={`${column}-${index}`} scope="col" className="whitespace-nowrap">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    title={cellDetail(cell)}
                    className={clsx(
                      "ft-value max-w-[24rem] truncate",
                      cell.type === "null" && "italic text-[var(--ft-text-faint)]",
                      cell.type === "blob" && "font-mono text-[var(--ft-text-muted)]",
                      (cell.type === "integer" || cell.type === "real") && "text-right tabular-nums",
                    )}
                  >
                    {cellText(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ft-meta border-t border-[var(--ft-rule)] px-3 py-1.5">
        {result.rowCount} ligne{result.rowCount > 1 ? "s" : ""} · {result.elapsedMs} ms
        {result.truncated && ` · affichage limité à ${result.limit} lignes`}
      </p>
    </section>
  );
}

/** Détail d'une table : colonnes, index, clés étrangères, instruction SQL. */
function SchemaView({ object }: { object: ObjectInfo }) {
  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
        <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">Colonnes</h3>
        <div className="overflow-x-auto">
          <table className="ft-table">
            <thead>
              <tr>
                <th scope="col">Nom</th>
                <th scope="col">Type déclaré</th>
                <th scope="col">Contraintes</th>
                <th scope="col">Défaut</th>
              </tr>
            </thead>
            <tbody>
              {object.columns.map((column) => (
                <tr key={column.name}>
                  <th scope="row" className="font-normal">
                    {column.name}
                  </th>
                  <td className="ft-value">{column.declaredType || "—"}</td>
                  <td className="ft-value">
                    {[
                      column.primaryKey ? "clé primaire" : undefined,
                      column.notNull ? "NOT NULL" : "facultative",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td className="ft-value">{column.defaultValue ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ft-meta border-t border-[var(--ft-rule)] px-3 py-1.5">
          SQLite n'impose pas les types : une colonne déclarée <code>INTEGER</code> peut contenir
          du texte. Le type est une intention, pas une garantie.
        </p>
      </section>

      {object.indexes.length > 0 && (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
          <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">Index</h3>
          <ul className="divide-y divide-[var(--ft-rule)]">
            {object.indexes.map((index) => (
              <li key={index.name} className="ft-row-py px-3">
                <span className="ft-value font-medium">{index.name}</span>
                <p className="ft-meta">
                  {index.columns.join(", ") || "—"}
                  {index.unique && " · unique"}
                  {index.partial && " · partiel"}
                  {index.origin === "pk" && " · issu de la clé primaire"}
                  {index.origin === "u" && " · issu d'une contrainte UNIQUE"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {object.foreignKeys.length > 0 && (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
          <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
            Clés étrangères
          </h3>
          <ul className="divide-y divide-[var(--ft-rule)]">
            {object.foreignKeys.map((key) => (
              <li key={`${key.column}-${key.referencesTable}`} className="ft-row-py px-3">
                <span className="ft-value">
                  {key.column} → {key.referencesTable}.{key.referencesColumn}
                </span>
                <p className="ft-meta">
                  À la suppression : {key.onDelete || "NO ACTION"} · à la mise à jour :{" "}
                  {key.onUpdate || "NO ACTION"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {object.sql && <TextPane label="Instruction de création" value={object.sql} readOnly droppable={false} minHeight="7rem" />}
    </div>
  );
}

/**
 * Explorateur de bases SQLite, **en lecture seule**.
 *
 * On vient ici pour comprendre le contenu d'un fichier, pas pour le modifier :
 * l'historique d'un navigateur, les notes d'une application, la base d'un
 * logiciel de gestion. Une modification accidentelle y serait d'autant plus
 * grave qu'elle est silencieuse — SQLite n'a pas de corbeille.
 *
 * La lecture seule n'est donc pas une intention affichée mais trois verrous
 * indépendants côté natif : connexion en lecture seule, `PRAGMA query_only`, et
 * un autorisateur consulté par le moteur pour chaque action. Le contrôle du
 * texte de la requête n'existe que pour **expliquer** un refus, jamais pour
 * l'assurer.
 */
export function SqliteExplorerTool({ tool }: ToolComponentProps) {
  // Chemin reçu de l'inspecteur de fichiers quand il a reconnu une signature
  // SQLite : l'outil s'ouvre directement sur la bonne base.
  const handed = useHandoffPaths(tool.id);
  const [paths, setPaths] = useState<string[]>(handed);
  const [overview, setOverview] = useState<DatabaseOverview | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const [pane, setPane] = useState<Pane>("data");
  const [rows, setRows] = useState<QueryResult | undefined>();
  const [sql, setSql] = useState("SELECT * FROM sqlite_master WHERE type = 'table';");
  const [queryResult, setQueryResult] = useState<QueryResult | undefined>();
  const [queryError, setQueryError] = useState<string | undefined>();
  const [limit, setLimit] = useState(DEFAULT_ROW_LIMIT);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const path = paths[0];
  const available = isTauri();

  // Ouverture : on repart d'un état vierge, pour ne jamais afficher le schéma
  // d'une base avec les lignes d'une autre.
  useEffect(() => {
    if (!path) {
      setOverview(undefined);
      setSelected(undefined);
      setRows(undefined);
      setQueryResult(undefined);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(undefined);
    openDatabase(path)
      .then((result) => {
        if (cancelled) return;
        setOverview(result);
        setSelected(result.objects[0]?.name);
        setOffset(0);
        setRows(undefined);
        setQueryResult(undefined);
        setQueryError(undefined);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setOverview(undefined);
        setError(failure instanceof Error ? failure.message : "Ouverture impossible.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const loadRows = useCallback(
    async (table: string, nextOffset: number) => {
      if (!path) return;
      setBusy(true);
      setError(undefined);
      try {
        setRows(await browseTable(path, table, limit, nextOffset));
        setOffset(nextOffset);
      } catch (failure) {
        setRows(undefined);
        setError(failure instanceof Error ? failure.message : "Lecture impossible.");
      } finally {
        setBusy(false);
      }
    },
    [path, limit],
  );

  useEffect(() => {
    if (pane === "data" && selected) void loadRows(selected, 0);
    // `loadRows` dépend déjà de la limite : la recharger ici suffit.
  }, [pane, selected, loadRows]);

  const current = useMemo(
    () => overview?.objects.find((object) => object.name === selected),
    [overview, selected],
  );

  const execute = async () => {
    if (!path) return;
    setBusy(true);
    setQueryError(undefined);
    try {
      setQueryResult(await runQuery(path, sql, limit));
    } catch (failure) {
      setQueryResult(undefined);
      setQueryError(failure instanceof Error ? failure.message : "Requête impossible.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async (result: QueryResult, name: string) => {
    try {
      const bytes = new TextEncoder().encode(queryToCsv(result));
      const saved = await saveFile({ name, bytes, mimeType: "text/csv" });
      if (saved.saved) notify.success("Export enregistré", saved.path);
    } catch (failure) {
      notify.error(
        "Export impossible",
        failure instanceof Error ? failure.message : undefined,
      );
    }
  };

  const shown = pane === "query" ? queryResult : rows;

  return (
    <div className="space-y-4">
      <Callout tone="info" title="Lecture seule, garantie par le moteur">
        {SQLITE_READ_ONLY_NOTE}
      </Callout>

      {!available && <Callout tone="warning">{SQLITE_NATIVE_REQUIRED}</Callout>}

      <PathPicker
        mode="files"
        paths={paths}
        onChange={setPaths}
        label="Base SQLite"
        hint="Fichier .sqlite, .sqlite3 ou .db. Il est ouvert en lecture seule."
        filters={[{ name: "Bases SQLite", extensions: ["sqlite", "sqlite3", "db"] }]}
      />

      {error && <Callout tone="error">{error}</Callout>}

      {overview && (
        <>
          <section className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2">
            <p className="ft-value">
              <strong>{baseName(overview.path)}</strong> · {formatBytes(overview.fileSize)} ·{" "}
              {overview.tables} table{overview.tables > 1 ? "s" : ""} · {overview.views} vue
              {overview.views > 1 ? "s" : ""}
            </p>
            <p className="ft-meta">
              SQLite {overview.sqliteVersion} · encodage {overview.encoding} · {overview.pageCount}{" "}
              pages de {overview.pageSize} octets · intégrité :{" "}
              {overview.integrity === "ok" ? "aucune anomalie" : overview.integrity}
            </p>
          </section>

          <div className="flex flex-col gap-4 lg:flex-row">
            <nav className="lg:w-56 lg:shrink-0">
              <h3 className="ft-section mb-1.5">Tables et vues</h3>
              <ul className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
                {overview.objects.map((object) => (
                  <li key={object.name}>
                    <button
                      type="button"
                      onClick={() => setSelected(object.name)}
                      className={clsx(
                        "flex w-full items-baseline gap-2 border-b border-[var(--ft-rule)] px-3 py-1.5 text-left last:border-b-0",
                        object.name === selected
                          ? "bg-[var(--ft-accent-quiet)] font-medium"
                          : "hover:bg-[var(--ft-surface-2)]",
                      )}
                    >
                      <Icon name={object.kind === "view" ? "Eye" : "Table"} size={13} />
                      <span className="ft-value min-w-0 flex-1 truncate">{object.name}</span>
                      <span className="ft-meta shrink-0">
                        {object.rows === null ? "vue" : object.rows}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="min-w-0 flex-1 space-y-3">
              <Fieldset columns={2}>
                <Field label="Affichage">
                  <OptionGroup
                    ariaLabel="Panneau"
                    value={pane}
                    onChange={setPane}
                    options={[
                      { value: "data", label: "Données" },
                      { value: "schema", label: "Schéma" },
                      { value: "query", label: "Requête" },
                    ]}
                  />
                </Field>
                <Field label="Lignes affichées au maximum">
                  <Select
                    value={String(limit)}
                    onChange={(value) => setLimit(Number(value))}
                    aria-label="Limite de lignes"
                    options={ROW_LIMITS.map((value) => ({
                      value: String(value),
                      label: `${value} lignes`,
                    }))}
                  />
                </Field>
              </Fieldset>

              {pane === "schema" && current && <SchemaView object={current} />}

              {pane === "query" && (
                <div className="space-y-2">
                  <TextPane
                    label="Requête SQL (lecture seule)"
                    value={sql}
                    onChange={setSql}
                    minHeight="7rem"
                    droppable={false}
                  />
                  <p className="ft-meta">
                    Autorisés : <code>SELECT</code>, <code>WITH … SELECT</code>,{" "}
                    <code>VALUES</code>, <code>EXPLAIN</code> et les <code>PRAGMA</code>{" "}
                    d'information. Une seule requête à la fois.
                  </p>
                  <Button variant="primary" onClick={execute} disabled={busy || !path}>
                    <Icon name="Play" size={14} /> Exécuter
                  </Button>
                  {queryError && <Callout tone="error">{queryError}</Callout>}
                </div>
              )}

              {pane === "data" && current?.rows !== null && current && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void loadRows(current.name, Math.max(0, offset - limit))}
                    disabled={busy || offset === 0}
                  >
                    <Icon name="ArrowLeft" size={13} /> Page précédente
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void loadRows(current.name, offset + limit)}
                    disabled={busy || !rows?.truncated}
                  >
                    Page suivante <Icon name="ArrowRight" size={13} />
                  </Button>
                  <span className="ft-meta">
                    Lignes {offset + 1} à {offset + (rows?.rowCount ?? 0)}
                    {current.rows !== null && ` sur ${current.rows}`}
                  </span>
                </div>
              )}

              {shown && (
                <>
                  <ResultTable result={shown} />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() =>
                        void exportCsv(
                          shown,
                          `${pane === "query" ? "requete" : (selected ?? "table")}.csv`,
                        )
                      }
                      disabled={shown.rowCount === 0}
                    >
                      <Icon name="Download" size={13} /> Exporter en CSV
                    </Button>
                  </div>
                  {shown.truncated && (
                    <Callout tone="info">
                      L'affichage s'arrête à {shown.limit} lignes : au-delà, un tableau cesse d'être
                      lisible et l'interface cesse d'être fluide. L'export CSV porte sur ce qui est
                      affiché — pour tout obtenir, augmentez la limite ou paginez.
                    </Callout>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
