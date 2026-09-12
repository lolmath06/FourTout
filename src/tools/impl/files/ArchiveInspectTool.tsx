import { useEffect, useState } from "react";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PasswordField } from "@/components/files/PasswordField";
import { PathPicker } from "@/components/files/PathPicker";
import { Panel, StatGrid } from "@/components/files/Summary";
import { Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Callout, type CalloutTone } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import {
  listArchive,
  testArchive,
  testStream,
  type ArchiveIntegrityReport,
  type ArchiveListing,
  type ArchiveVerdict,
} from "@/core/files/native";
import { baseName } from "@/core/files/paths";
import { HANDOFF_TARGETS } from "@/features/handoff/targets";
import { OpenToolButton } from "@/features/handoff/openTool";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Inspection et test d'intégrité d'une archive.
 *
 * Deux gestes voisins que l'outil tient à distinguer :
 *
 * - **Inspecter** lit la table des matières et ne décompresse rien. C'est
 *   instantané, même sur une archive de plusieurs gigaoctets — et c'est là que
 *   les entrées dangereuses (chemins qui remontent, chemins absolus) sont
 *   signalées, avant même qu'on envisage d'extraire.
 * - **Tester** décompresse réellement tout le contenu et vérifie ses sommes de
 *   contrôle, sans rien écrire sur le disque. C'est long, et c'est la seule
 *   réponse honnête à « cette archive est-elle encore bonne ? » : lister ne
 *   prouve rien, seul l'en-tête serait lu.
 */
const VERDICT_TONE: Record<ArchiveVerdict, CalloutTone> = {
  valid: "success",
  corrupt: "error",
  incomplete: "error",
  encrypted: "warning",
  unsupported: "neutral",
};

const VERDICT_TITLE: Record<ArchiveVerdict, string> = {
  valid: "Archive valide",
  corrupt: "Archive corrompue",
  incomplete: "Archive incomplète",
  encrypted: "Archive protégée par mot de passe",
  unsupported: "Format non pris en charge",
};

const STREAM_EXTENSIONS = /\.(gz|xz)$/i;
const TARBALL = /\.(tar\.gz|tgz|tar\.xz|txz)$/i;

export function ArchiveInspectTool({ tool }: ToolComponentProps) {
  const [mode, setMode] = useState<"inspect" | "test">(
    tool.id === "archive-test" ? "test" : "inspect",
  );
  const received = useHandoffPaths(tool.id);
  const [paths, setPaths] = useState<string[]>(received);
  const [password, setPassword] = useState("");

  const listing = useNativeAction<ArchiveListing>();
  const integrity = useNativeAction<ArchiveIntegrityReport>();

  /**
   * Ce que l'en-tête de l'archive dit d'elle-même, lu dès la sélection.
   *
   * Il sert à une seule chose, mais elle compte : ne demander un mot de passe
   * que lorsqu'il y en a un. Un champ secret affiché devant chaque TAR ou
   * chaque GZ laisse croire qu'on attend quelque chose de l'utilisateur, alors
   * que ces formats n'ont pas de chiffrement du tout.
   */
  const [probe, setProbe] = useState<{ encrypted: boolean } | null>(null);
  const [askPassword, setAskPassword] = useState(false);

  const selected = paths[0];

  // La lecture d'en-tête est instantanée : elle ne décompresse rien.
  useEffect(() => {
    let cancelled = false;
    setProbe(null);
    setAskPassword(false);
    if (!selected) return;
    (async () => {
      try {
        const description = await listArchive(selected);
        if (!cancelled) setProbe({ encrypted: description.encrypted });
      } catch {
        // Format sans table des matières (.gz, .xz) ou archive illisible :
        // on ne sait pas, et on ne demande donc rien de plus.
        if (!cancelled) setProbe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (!isNativeAvailable()) return <NativeRequired />;

  const path = paths[0];
  const name = path ? baseName(path).toLowerCase() : "";
  /** Un `.gz` ou `.xz` nu n'a pas de table des matières : rien à lister. */
  const isBareStream = STREAM_EXTENSIONS.test(name) && !TARBALL.test(name);
  /**
   * Seul le ZIP porte un chiffrement dans FourTout. TAR, GZ et XZ n'en ont
   * aucun par construction ; le 7z chiffré n'est pas proposé.
   */
  const supportsPassword = /\.zip$/i.test(name);

  const reset = () => {
    listing.setResult(null);
    integrity.setResult(null);
  };

  const run = () => {
    if (mode === "inspect") {
      void listing.execute(() => listArchive(path));
      return;
    }
    if (isBareStream) {
      const format = name.endsWith(".xz") ? "xz" : "gz";
      void integrity.execute(async (context) => {
        const produced = await testStream(path, format, context);
        return {
          path,
          format: format.toUpperCase(),
          verdict: "valid" as const,
          checked: 1,
          bytes: produced,
          failures: [],
          detail: `Le flux se décompresse entièrement (${formatFileSize(produced)}) et sa somme de contrôle est correcte.`,
        };
      });
      return;
    }
    void integrity.execute((context) =>
      testArchive(path, password.length > 0 ? password : null, context),
    );
  };

  return (
    <div className="space-y-4">
      <OptionGroup
        ariaLabel="Inspecter ou tester"
        value={mode}
        onChange={(next) => {
          setMode(next);
          reset();
        }}
        options={[
          { value: "inspect", label: "Inspecter", hint: "Lit la table des matières. Rien n'est décompressé." },
          { value: "test", label: "Tester", hint: "Décompresse tout et vérifie les sommes de contrôle. Rien n'est écrit." },
        ]}
      />

      <PathPicker
        mode="files"
        paths={paths}
        onChange={(next) => {
          setPaths(next);
          reset();
        }}
        label="Archive à examiner"
        hint="ZIP, 7z, TAR, TAR.GZ, TAR.XZ, GZ, XZ"
        filters={[
          {
            name: "Archives",
            extensions: ["zip", "7z", "tar", "gz", "tgz", "xz", "txz"],
          },
        ]}
      />

      {path && mode === "inspect" && isBareStream && (
        <Callout tone="info" title="Ce format n'a pas de table des matières">
          Un « .{name.endsWith(".xz") ? "xz" : "gz"} » ne contient qu'un flux d'octets, sans liste
          d'entrées : il n'y a rien à inspecter. Le mode « Tester » sait en revanche vérifier qu'il
          se décompresse entièrement.
        </Callout>
      )}

      {/*
        Le mot de passe n'apparaît que s'il sert : une archive dont l'en-tête
        annonce des entrées chiffrées, ou un doute que l'utilisateur lève
        lui-même. Les TAR, GZ et XZ n'ont aucun chiffrement — leur montrer un
        champ secret serait une question sans objet.
      */}
      {path && mode === "test" && supportsPassword && probe?.encrypted && (
        <Fieldset columns={1} title="Archive protégée par mot de passe">
          <PasswordField
            value={password}
            onChange={setPassword}
            label="Mot de passe"
            hint="L'en-tête de cette archive annonce des entrées chiffrées : sans le mot de passe, leur contenu ne peut pas être vérifié."
          />
        </Fieldset>
      )}

      {path && mode === "test" && supportsPassword && probe && !probe.encrypted && (
        <>
          {askPassword ? (
            <Fieldset columns={1} title="Archive protégée par mot de passe">
              <PasswordField
                value={password}
                onChange={setPassword}
                label="Mot de passe"
                hint="L'en-tête n'annonce aucune entrée chiffrée ; ce champ n'est là que si vous savez le contraire."
              />
            </Fieldset>
          ) : (
            <button
              type="button"
              onClick={() => setAskPassword(true)}
              className="text-xs text-[var(--ft-text-muted)] underline-offset-2 hover:underline"
            >
              Cette archive est protégée par un mot de passe ?
            </button>
          )}
        </>
      )}

      {path && !(mode === "inspect" && isBareStream) && (
        <RunBar
          label={mode === "inspect" ? "Inspecter l'archive" : "Tester l'intégrité"}
          icon={mode === "inspect" ? "FileSearch2" : "PackageCheck"}
          running={listing.job.isRunning || integrity.job.isRunning}
          progress={mode === "inspect" ? listing.job.progress : integrity.job.progress}
          status={mode === "inspect" ? listing.job.status : integrity.job.status}
          error={mode === "inspect" ? listing.error : integrity.error}
          cancel={mode === "inspect" ? listing.job.cancel : integrity.job.cancel}
          onRun={run}
        />
      )}

      {(listing.result || integrity.result) && path && (
        <div className="flex flex-wrap items-center gap-2" data-testid="archive-handoffs">
          <span className="ft-label">Continuer avec</span>
          {!isBareStream && (
            <OpenToolButton
              toolId={HANDOFF_TARGETS.archiveExtract}
              paths={[path]}
              variant="primary"
            />
          )}
          {isBareStream && (
            <OpenToolButton toolId={HANDOFF_TARGETS.decompress} paths={[path]} variant="primary" />
          )}
          <OpenToolButton toolId={HANDOFF_TARGETS.inspect} paths={[path]} />
          <OpenToolButton toolId={HANDOFF_TARGETS.hash} paths={[path]} />
        </div>
      )}

      {listing.result && <Listing listing={listing.result} />}
      {integrity.result && <Integrity report={integrity.result} />}
    </div>
  );
}

function Listing({ listing }: { listing: ArchiveListing }) {
  const rejected = listing.entries.filter((entry) => entry.rejected);
  const ratio = listing.totalSize > 0 ? listing.archiveSize / listing.totalSize : 0;

  return (
    <div className="space-y-3" data-testid="archive-listing">
      <StatGrid
        columns={5}
        stats={[
          { label: "Entrées", value: listing.entries.length },
          { label: "Fichiers", value: listing.files },
          { label: "Décompressé", value: formatFileSize(listing.totalSize) },
          { label: "Sur le disque", value: formatFileSize(listing.archiveSize) },
          {
            label: "Taux",
            value: listing.totalSize > 0 ? `${(ratio * 100).toFixed(1)} %` : "—",
          },
        ]}
      />

      {listing.encrypted && (
        <Callout tone="warning" title="Archive protégée par mot de passe">
          Les noms et les tailles restent lisibles — c'est une limite du format ZIP — mais le
          contenu ne peut être ni extrait ni vérifié sans le mot de passe.
        </Callout>
      )}

      {listing.suspicious && (
        <Callout tone="warning" title="Taux de compression anormal">
          Cette archive annonce {formatFileSize(listing.totalSize)} décompressés pour{" "}
          {formatFileSize(listing.archiveSize)} sur le disque. Un tel rapport est le profil d'une
          « bombe de décompression » : vérifiez d'où vient ce fichier avant de l'extraire.
        </Callout>
      )}

      {rejected.length > 0 && (
        <Callout tone="error" title={`${rejected.length} entrée(s) dangereuse(s)`}>
          Ces entrées désignent des emplacements hors du dossier d'extraction. FourTout refusera de
          les écrire — mais leur seule présence indique une archive fabriquée pour piéger l'outil
          qui l'ouvre.
        </Callout>
      )}

      <Panel title="Contenu" count={listing.entries.length} testId="archive-entries">
        <ul className="max-h-[32rem] divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
          {listing.entries.slice(0, 1000).map((entry) => (
            <li
              key={entry.name}
              className="flex items-center gap-2 px-3 py-1"
              style={
                entry.rejected
                  ? { background: "color-mix(in oklch, var(--ft-danger) 6%, transparent)" }
                  : undefined
              }
            >
              <Icon
                name={entry.rejected ? "TriangleAlert" : entry.isDir ? "FolderTree" : "File"}
                size={13}
                className={
                  entry.rejected
                    ? "shrink-0 text-[var(--ft-danger)]"
                    : "shrink-0 text-[var(--ft-text-faint)]"
                }
              />
              <span className="min-w-0 flex-1 truncate font-mono" title={entry.name}>
                {entry.name}
              </span>
              {entry.rejected && (
                <span className="shrink-0 text-[var(--ft-danger)]">{entry.rejected}</span>
              )}
              {!entry.isDir && (
                <>
                  <span className="shrink-0 tabular-nums text-[var(--ft-text-muted)]">
                    {formatFileSize(entry.size)}
                  </span>
                  {entry.compressedSize > 0 && (
                    <span className="shrink-0 tabular-nums text-[var(--ft-text-faint)]">
                      → {formatFileSize(entry.compressedSize)}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
          {listing.entries.length > 1000 && (
            <li className="px-3 py-1 text-[var(--ft-text-faint)]">
              … et {(listing.entries.length - 1000).toLocaleString("fr-FR")} de plus
            </li>
          )}
        </ul>
      </Panel>
    </div>
  );
}

function Integrity({ report }: { report: ArchiveIntegrityReport }) {
  return (
    <div className="space-y-3" data-testid="archive-integrity">
      <StatGrid
        columns={4}
        stats={[
          { label: "Format", value: report.format },
          {
            label: "Verdict",
            value: VERDICT_TITLE[report.verdict],
            tone: report.verdict === "valid" ? "ok" : report.verdict === "encrypted" ? "warn" : "danger",
          },
          { label: "Entrées vérifiées", value: report.checked },
          { label: "Octets décompressés", value: formatFileSize(report.bytes) },
        ]}
      />

      <Callout tone={VERDICT_TONE[report.verdict]} title={VERDICT_TITLE[report.verdict]}>
        {report.detail}
      </Callout>

      {report.failures.length > 0 && (
        <Panel title="Détail des anomalies" count={report.failures.length}>
          <ul className="max-h-72 divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
            {report.failures.slice(0, 200).map((failure, index) => (
              <li key={`${index}-${failure}`} className="px-3 py-1 font-mono">
                {failure}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
