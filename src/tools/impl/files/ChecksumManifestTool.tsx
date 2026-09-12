import { useState } from "react";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PathPicker } from "@/components/files/PathPicker";
import { Panel, StatGrid } from "@/components/files/Summary";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { CheckOption } from "@/components/text/TextToolShell";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import {
  checksumsAreValid,
  createManifest,
  DEFAULT_WALK_OPTIONS,
  pickSavePath,
  verifyManifest,
  type ChecksumStatus,
  type ChecksumVerifyReport,
  type HashAlgorithm,
  type ManifestFormat,
  type ManifestSummary,
} from "@/core/files/native";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import { revealFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Manifestes d'empreintes : création et vérification.
 *
 * Un seul écran pour les deux moitiés d'un même geste — on crée un manifeste
 * pour le vérifier plus tard, et on le vérifie parce qu'on l'a créé. Le
 * catalogue expose les deux intentions séparément ; l'implémentation, elle,
 * n'a aucune raison d'être dupliquée.
 *
 * Le format texte produit est celui de `sha256sum` : il se relit avec les
 * outils du système, sur n'importe quelle machine, même sans FourTout.
 */
const ALGORITHMS: { value: HashAlgorithm; label: string; hint: string }[] = [
  { value: "sha256", label: "SHA-256", hint: "Le choix par défaut, sûr et universellement lisible." },
  { value: "sha512", label: "SHA-512", hint: "Plus long, aussi sûr ; utile si votre source le publie ainsi." },
  {
    value: "sha1",
    label: "SHA-1",
    hint: "Hérité : cassé depuis 2017. Utile pour vérifier une empreinte publiée autrefois, pas pour prouver qu'un fichier n'a pas été modifié volontairement.",
  },
  {
    value: "md5",
    label: "MD5",
    hint: "Hérité : cassé depuis 2004. Même usage limité que SHA-1.",
  },
];

const FORMATS: { value: ManifestFormat; label: string; hint: string }[] = [
  {
    value: "text",
    label: "Texte (.sha256)",
    hint: "Format de sha256sum : « empreinte  chemin ». Relisible par les outils du système.",
  },
  {
    value: "json",
    label: "JSON FourTout",
    hint: "Mêmes empreintes, plus les tailles. Pratique pour un traitement automatisé.",
  },
];

const STATUS_LABEL: Record<ChecksumStatus, string> = {
  ok: "Intact",
  mismatch: "Empreinte différente",
  missing: "Manquant",
  unreadable: "Illisible",
  refused: "Refusé — sortirait du dossier vérifié",
};

export function ChecksumManifestTool({ tool }: ToolComponentProps) {
  const received = useHandoffPaths(tool.id);
  const [mode, setMode] = useState<"create" | "verify">(
    tool.id === "checksum-verify" ? "verify" : "create",
  );
  /**
   * Manifeste et racine transmis du mode « Créer » au mode « Vérifier ».
   *
   * Créer un manifeste puis devoir resélectionner à la main le fichier qu'on
   * vient d'écrire, et le dossier dont on vient de partir, n'a aucun sens :
   * les deux moitiés du geste se passent le relais.
   */
  const [verifyManifestPath, setVerifyManifestPath] = useState<string[]>(
    tool.id === "checksum-verify" ? received : [],
  );
  const [verifyRoot, setVerifyRoot] = useState<string[]>([]);

  return (
    <div className="space-y-4">
      <OptionGroup
        ariaLabel="Créer ou vérifier un manifeste"
        value={mode}
        onChange={setMode}
        options={[
          { value: "create", label: "Créer un manifeste" },
          { value: "verify", label: "Vérifier un manifeste" },
        ]}
      />
      {mode === "create" ? (
        <CreatePanel
          onVerify={(manifestPath, root) => {
            setVerifyManifestPath([manifestPath]);
            setVerifyRoot([root]);
            setMode("verify");
          }}
        />
      ) : (
        <VerifyPanel
          manifest={verifyManifestPath}
          setManifest={setVerifyManifestPath}
          root={verifyRoot}
          setRoot={setVerifyRoot}
        />
      )}
    </div>
  );
}

function CreatePanel({ onVerify }: { onVerify: (manifest: string, root: string) => void }) {
  const [root, setRoot] = useState<string[]>([]);
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>("sha256");
  const [format, setFormat] = useState<ManifestFormat>("text");
  const [includeHidden, setIncludeHidden] = useState(false);
  const action = useNativeAction<ManifestSummary>();

  if (!isNativeAvailable()) return <NativeRequired />;

  const legacy = ALGORITHMS.find((entry) => entry.value === algorithm && entry.value !== "sha256" && entry.value !== "sha512");

  const run = async () => {
    // Nom proposé prévisible : l'utilisateur n'a pas à comprendre qu'on lui
    // demande un **chemin de fichier de sortie**, la boîte de dialogue
    // d'enregistrement du système s'en charge.
    const extension = format === "json" ? "json" : algorithm;
    const output = await pickSavePath(`checksums.${extension}`);
    if (!output) return;
    const summary = await action.execute((context) =>
      createManifest(
        {
          root: root[0],
          algorithm,
          format,
          output,
          walk: { ...DEFAULT_WALK_OPTIONS, includeHidden },
        },
        context,
      ),
    );
    if (summary) {
      notify.success("Manifeste créé", `${summary.files} fichier(s) · ${summary.algorithm}`);
    }
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
        label="1. Dossier à inventorier"
        hint="chaque fichier qu'il contient sera listé, avec un chemin relatif à ce dossier"
        disabled={action.job.isRunning}
      />

      {root.length > 0 && (
        <>
          <Fieldset columns={2} title="Manifeste">
            <Field
              label="Algorithme"
              hint={ALGORITHMS.find((entry) => entry.value === algorithm)?.hint}
            >
              <OptionGroup
                ariaLabel="Algorithme d'empreinte"
                value={algorithm}
                onChange={setAlgorithm}
                options={ALGORITHMS}
              />
            </Field>
            <Field label="Format" hint={FORMATS.find((entry) => entry.value === format)?.hint}>
              <OptionGroup
                ariaLabel="Format du manifeste"
                value={format}
                onChange={setFormat}
                options={FORMATS}
              />
            </Field>
            <Field label="Portée" full>
              <CheckOption
                checked={includeHidden}
                onChange={setIncludeHidden}
                label="Inclure les fichiers cachés"
              />
            </Field>
          </Fieldset>

          {legacy && (
            <Callout tone="warning" title={`${legacy.label} n'est plus un algorithme de sécurité`}>
              {legacy.hint}
            </Callout>
          )}

          <Callout tone="neutral" title="Ce que FourTout va écrire">
            Un fichier texte, une ligne par fichier :
            <code className="mt-1 block font-mono text-[11px]">
              e3b0c442…  documents/rapport.txt
            </code>
            À l'étape suivante, la boîte de dialogue du système vous demandera{" "}
            <strong>où enregistrer ce fichier</strong>.
          </Callout>

          <RunBar
            label="Créer le manifeste…"
            icon="ListChecks"
            running={action.job.isRunning}
            progress={action.job.progress}
            status={action.job.status}
            error={action.error}
            cancel={action.job.cancel}
            onRun={() => void run()}
          />
        </>
      )}

      {action.result && (
        <div className="space-y-3" data-testid="manifest-summary">
          <StatGrid
            columns={4}
            stats={[
              { label: "Fichiers", value: action.result.files },
              { label: "Volume", value: formatFileSize(action.result.bytes) },
              { label: "Algorithme", value: action.result.algorithm },
              {
                label: "Erreurs",
                value: action.result.errors.length,
                tone: action.result.errors.length > 0 ? "danger" : "neutral",
              },
            ]}
          />
          <Callout
            tone="success"
            title="Manifeste enregistré"
            actions={
              <Button size="sm" onClick={() => revealFile(action.result!.output)}>
                <Icon name="FolderTree" size={13} /> Ouvrir l'emplacement
              </Button>
            }
          >
            <span className="block">
              Emplacement : <code className="font-mono">{action.result.output}</code>
            </span>
            <span className="mt-0.5 block">
              Il décrit {action.result.files} fichier(s) du dossier{" "}
              <code className="font-mono">{root[0]}</code>.
            </span>
          </Callout>

          {/* La suite logique, sans resélection : on vient d'écrire ce
              manifeste, et on sait déjà à quelle racine il se rapporte. */}
          <div className="flex flex-wrap items-center gap-2" data-testid="manifest-handoff">
            <span className="ft-label">Et maintenant</span>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onVerify(action.result!.output, root[0])}
            >
              <Icon name="ShieldCheck" size={13} /> Vérifier ce manifeste
            </Button>
          </div>
          {action.result.legacyWarning && (
            <Callout tone="warning" title="Algorithme hérité">
              {action.result.legacyWarning}
            </Callout>
          )}
        </div>
      )}
    </div>
  );
}

function VerifyPanel({
  manifest,
  setManifest,
  root,
  setRoot,
}: {
  manifest: string[];
  setManifest: (paths: string[]) => void;
  root: string[];
  setRoot: (paths: string[]) => void;
}) {
  const action = useNativeAction<ChecksumVerifyReport>();

  if (!isNativeAvailable()) return <NativeRequired />;

  const ready = manifest.length > 0 && root.length > 0;
  const report = action.result;
  const problems = report?.results.filter((entry) => entry.status !== "ok") ?? [];

  return (
    <div className="space-y-4">
      {/*
        Deux sélections, et rien dans leurs intitulés ne disait laquelle
        attendait quoi. L'exemple ci-dessous montre comment les deux se
        combinent — c'est la seule façon de rendre la mécanique évidente sans
        demander à l'utilisateur de la deviner.
      */}
      <Callout tone="neutral" title="Comment ces deux champs se combinent">
        <span className="block">
          Un manifeste contient des chemins <strong>relatifs</strong> :
        </span>
        <code className="mt-1 block font-mono text-[11px]">
          e3b0c442…&nbsp;&nbsp;docs/readme.txt
        </code>
        <span className="mt-1 block">
          Avec la racine <code className="font-mono">/home/vous/projet/</code>, FourTout vérifiera
          donc <code className="font-mono">/home/vous/projet/docs/readme.txt</code>.
        </span>
      </Callout>

      <div className="grid gap-3 sm:grid-cols-2">
        <PathPicker
          mode="files"
          paths={manifest}
          onChange={(next) => {
            setManifest(next);
            action.setResult(null);
          }}
          label="1. Le fichier de checksums"
          hint="un .sha256, .sha512, .sha1, .md5 — ou le JSON écrit par FourTout"
          filters={[
            {
              name: "Manifestes d'empreintes",
              extensions: ["sha256", "sha512", "sha1", "md5", "txt", "json", "sum"],
            },
          ]}
        />
        <PathPicker
          mode="directory"
          paths={root}
          onChange={(next) => {
            setRoot(next);
            action.setResult(null);
          }}
          label="2. Le dossier contenant les fichiers"
          hint="la racine à laquelle les chemins du manifeste se rapportent"
        />
      </div>

      {ready && (
        <RunBar
          label="Vérifier"
          icon="ShieldCheck"
          running={action.job.isRunning}
          progress={action.job.progress}
          status={action.job.status}
          error={action.error}
          cancel={action.job.cancel}
          onRun={() =>
            void action.execute((context) => verifyManifest(manifest[0], root[0], context))
          }
        />
      )}

      {report && (
        <div className="space-y-3" data-testid="checksum-report">
          <StatGrid
            columns={5}
            stats={[
              { label: "Intacts", value: report.ok, tone: "ok" },
              { label: "Modifiés", value: report.mismatched, tone: report.mismatched > 0 ? "danger" : "neutral" },
              { label: "Manquants", value: report.missing, tone: report.missing > 0 ? "danger" : "neutral" },
              { label: "Illisibles", value: report.unreadable, tone: report.unreadable > 0 ? "warn" : "neutral" },
              { label: "Refusés", value: report.refused, tone: report.refused > 0 ? "danger" : "neutral" },
            ]}
          />

          {checksumsAreValid(report) ? (
            <Callout tone="success" title={`Tout correspond — ${report.algorithm}`}>
              Les {report.ok} fichiers du manifeste sont présents et inchangés.
            </Callout>
          ) : (
            <Callout tone="error" title="Le dossier ne correspond plus au manifeste">
              Le détail figure ci-dessous, fichier par fichier.
            </Callout>
          )}

          {report.refused > 0 && (
            <Callout tone="error" title="Entrées refusées pour raison de sécurité">
              Ce manifeste contient des chemins qui sortiraient du dossier vérifié (« ../ » ou
              chemin absolu). FourTout ne les a pas suivis : un fichier de checksums reçu de
              l'extérieur est une donnée, pas une instruction.
            </Callout>
          )}

          {report.legacyWarning && (
            <Callout tone="warning" title="Algorithme hérité">
              {report.legacyWarning}
            </Callout>
          )}

          {problems.length > 0 && (
            <Panel title="Fichiers en défaut" count={problems.length}>
              <ul className="max-h-96 divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
                {problems.slice(0, 500).map((entry) => (
                  <li key={entry.relative} className="flex items-start gap-2 px-3 py-1">
                    <span className="mt-px shrink-0 text-[var(--ft-danger)]">
                      <Icon name="TriangleAlert" size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono" title={entry.relative}>
                        {entry.relative}
                      </span>
                      <span className="block text-[11px] text-[var(--ft-text-muted)]">
                        {STATUS_LABEL[entry.status]}
                        {entry.detail && ` — ${entry.detail}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
