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
import { Trans, t, tx } from "@/i18n";

type Pane = "data" | "schema" | "query";

const ROW_LIMITS = [100, 500, 1000, 5000];

/** Tableau de résultats. Un BLOB y est nommé, jamais rendu comme du texte. */
function ResultTable({ result }: { result: QueryResult }) {
  if (result.columns.length === 0) {
    return <Callout tone="info">{t("Cette requête ne renvoie aucune colonne.")}</Callout>;
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
        {t("{rowCount} {rowCount, plural, one {ligne} other {lignes}} · {elapsedMs} ms{value}", { rowCount: result.rowCount, elapsedMs: result.elapsedMs, value: result.truncated && t(" · affichage limité à {limit} lignes", { limit: result.limit }) })}
      </p>
    </section>
  );
}

/** Détail d'une table : colonnes, index, clés étrangères, instruction SQL. */
function SchemaView({ object }: { object: ObjectInfo }) {
  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
        <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">{t("Colonnes")}</h3>
        <div className="overflow-x-auto">
          <table className="ft-table">
            <thead>
              <tr>
                <th scope="col">{t("Nom")}</th>
                <th scope="col">{t("Type déclaré")}</th>
                <th scope="col">{t("Contraintes")}</th>
                <th scope="col">{t("Défaut")}</th>
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
                      column.primaryKey ? t("clé primaire") : undefined,
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
          <Trans source={"SQLite n'impose pas les types : une colonne déclarée <0>INTEGER</0> peut contenir du texte. Le type est une intention, pas une garantie."} components={[<code />]} />
        </p>
      </section>

      {object.indexes.length > 0 && (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
          <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">{t("Index")}</h3>
          <ul className="divide-y divide-[var(--ft-rule)]">
            {object.indexes.map((index) => (
              <li key={index.name} className="ft-row-py px-3">
                <span className="ft-value font-medium">{index.name}</span>
                <p className="ft-meta">
                  {index.columns.join(", ") || "—"}
                  {index.unique && " · unique"}
                  {index.partial && " · partiel"}
                  {index.origin === "pk" && t(" · issu de la clé primaire")}
                  {index.origin === "u" && t(" · issu d'une contrainte UNIQUE")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {object.foreignKeys.length > 0 && (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
          <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
            {t("Clés étrangères")}
          </h3>
          <ul className="divide-y divide-[var(--ft-rule)]">
            {object.foreignKeys.map((key) => (
              <li key={`${key.column}-${key.referencesTable}`} className="ft-row-py px-3">
                <span className="ft-value">
                  {key.column} → {key.referencesTable}.{key.referencesColumn}
                </span>
                <p className="ft-meta">
                  {t("À la suppression : {value} · à la mise à jour : {value2}", { value: key.onDelete || "NO ACTION", value2: key.onUpdate || "NO ACTION" })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {object.sql && <TextPane label={t("Instruction de création")} value={object.sql} readOnly droppable={false} minHeight="7rem" />}
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
        setError(failure instanceof Error ? failure.message : t("Ouverture impossible."));
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
        setError(failure instanceof Error ? failure.message : t("Lecture impossible."));
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
      setQueryError(failure instanceof Error ? failure.message : t("Requête impossible."));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async (result: QueryResult, name: string) => {
    try {
      const bytes = new TextEncoder().encode(queryToCsv(result));
      const saved = await saveFile({ name, bytes, mimeType: "text/csv" });
      if (saved.saved) notify.success(t("Export enregistré"), saved.path);
    } catch (failure) {
      notify.error(
        t("Export impossible"),
        failure instanceof Error ? failure.message : undefined,
      );
    }
  };

  const shown = pane === "query" ? queryResult : rows;

  return (
    <div className="space-y-4">
      <Callout tone="info" title={t("Lecture seule, garantie par le moteur")}>
        {SQLITE_READ_ONLY_NOTE}
      </Callout>

      {!available && <Callout tone="warning">{SQLITE_NATIVE_REQUIRED}</Callout>}

      <PathPicker
        mode="files"
        paths={paths}
        onChange={setPaths}
        label={t("Base SQLite")}
        hint={t("Fichier .sqlite, .sqlite3 ou .db. Il est ouvert en lecture seule.")}
        filters={[{ name: t("Bases SQLite"), extensions: ["sqlite", "sqlite3", "db"] }]}
      />

      {error && <Callout tone="error">{tx(error)}</Callout>}

      {overview && (
        <>
          <section className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2">
            <p className="ft-value">
              <Trans source={"<0>{value}</0> · {size} · {tables} {tables, plural, one {table} other {tables}} · {views} {views, plural, one {vue} other {vues}}"} values={{ value: baseName(overview.path), size: formatBytes(overview.fileSize), tables: overview.tables, views: overview.views }} components={[<strong />]} />
            </p>
            <p className="ft-meta">
              {t("SQLite {sqliteVersion} · encodage {encoding} · {pageCount} pages de {pageSize} octets · intégrité : {value}", { sqliteVersion: overview.sqliteVersion, encoding: overview.encoding, pageCount: overview.pageCount, pageSize: overview.pageSize, value: overview.integrity === "ok" ? t("aucune anomalie") : overview.integrity })}
            </p>
          </section>

          <div className="flex flex-col gap-4 lg:flex-row">
            <nav className="lg:w-56 lg:shrink-0">
              <h3 className="ft-section mb-1.5">{t("Tables et vues")}</h3>
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
                <Field label={t("Affichage")}>
                  <OptionGroup
                    ariaLabel={t("Panneau")}
                    value={pane}
                    onChange={setPane}
                    options={[
                      { value: "data", label: t("Données") },
                      { value: "schema", label: t("Schéma") },
                      { value: "query", label: t("Requête") },
                    ]}
                  />
                </Field>
                <Field label={t("Lignes affichées au maximum")}>
                  <Select
                    value={String(limit)}
                    onChange={(value) => setLimit(Number(value))}
                    aria-label={t("Limite de lignes")}
                    options={ROW_LIMITS.map((value) => ({
                      value: String(value),
                      label: t("{value} lignes", { value }),
                    }))}
                  />
                </Field>
              </Fieldset>

              {pane === "schema" && current && <SchemaView object={current} />}

              {pane === "query" && (
                <div className="space-y-2">
                  <TextPane
                    label={t("Requête SQL (lecture seule)")}
                    value={sql}
                    onChange={setSql}
                    minHeight="7rem"
                    droppable={false}
                  />
                  <p className="ft-meta">
                    <Trans source={"Autorisés : <0>SELECT</0>, <1>WITH … SELECT</1>, <2>VALUES</2>, <3>EXPLAIN</3> et les <4>PRAGMA</4> d'information. Une seule requête à la fois."} components={[<code />, <code />, <code />, <code />, <code />]} />
                  </p>
                  <Button variant="primary" onClick={execute} disabled={busy || !path}>
                    <Icon name="Play" size={14} />{" "}{t("Exécuter")}
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
                    <Icon name="ArrowLeft" size={13} />{" "}{t("Page précédente")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void loadRows(current.name, offset + limit)}
                    disabled={busy || !rows?.truncated}
                  >
                    {t("Page suivante")}{" "}<Icon name="ArrowRight" size={13} />
                  </Button>
                  <Trans source={"<0>Lignes {value} à {value2}{value3}</0>"} values={{ value: offset + 1, value2: offset + (rows?.rowCount ?? 0), value3: current.rows !== null && t(" sur {rows}", { rows: current.rows }) }} components={[<span className="ft-meta" />]} />
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
                      <Icon name="Download" size={13} />{" "}{t("Exporter en CSV")}
                    </Button>
                  </div>
                  {shown.truncated && (
                    <Callout tone="info">
                      {t("L'affichage s'arrête à {limit} lignes : au-delà, un tableau cesse d'être lisible et l'interface cesse d'être fluide. L'export CSV porte sur ce qui est affiché — pour tout obtenir, augmentez la limite ou paginez.", { limit: shown.limit })}
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
