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
import { Trans, localized, t, tx } from "@/i18n";

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
const ALGORITHMS: { value: HashAlgorithm; label: string; hint: string }[] = localized(() => [
  { value: "sha256", label: "SHA-256", hint: t("Le choix par défaut, sûr et universellement lisible.") },
  { value: "sha512", label: "SHA-512", hint: t("Plus long, aussi sûr ; utile si votre source le publie ainsi.") },
  {
    value: "sha1",
    label: "SHA-1",
    hint: t("Hérité : cassé depuis 2017. Utile pour vérifier une empreinte publiée autrefois, pas pour prouver qu'un fichier n'a pas été modifié volontairement."),
  },
  {
    value: "md5",
    label: "MD5",
    hint: t("Hérité : cassé depuis 2004. Même usage limité que SHA-1."),
  },
]);

const FORMATS: { value: ManifestFormat; label: string; hint: string }[] = localized(() => [
  {
    value: "text",
    label: t("Texte (.sha256)"),
    hint: t("Format de sha256sum : « empreinte  chemin ». Relisible par les outils du système."),
  },
  {
    value: "json",
    label: t("JSON FourTout"),
    hint: t("Mêmes empreintes, plus les tailles. Pratique pour un traitement automatisé."),
  },
]);

const STATUS_LABEL: Record<ChecksumStatus, string> = localized(() => ({
  ok: "Intact",
  mismatch: t("Empreinte différente"),
  missing: "Manquant",
  unreadable: "Illisible",
  refused: t("Refusé — sortirait du dossier vérifié"),
}));

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
        ariaLabel={t("Créer ou vérifier un manifeste")}
        value={mode}
        onChange={setMode}
        options={[
          { value: "create", label: t("Créer un manifeste") },
          { value: "verify", label: t("Vérifier un manifeste") },
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
      notify.success(t("Manifeste créé"), `${summary.files} fichier(s) · ${summary.algorithm}`);
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
        label={t("1. Dossier à inventorier")}
        hint={t("chaque fichier qu'il contient sera listé, avec un chemin relatif à ce dossier")}
        disabled={action.job.isRunning}
      />

      {root.length > 0 && (
        <>
          <Fieldset columns={2} title={t("Manifeste")}>
            <Field
              label={t("Algorithme")}
              hint={tx(ALGORITHMS.find((entry) => entry.value === algorithm)?.hint)}
            >
              <OptionGroup
                ariaLabel={t("Algorithme d'empreinte")}
                value={algorithm}
                onChange={setAlgorithm}
                options={ALGORITHMS}
              />
            </Field>
            <Field label={t("Format")} hint={tx(FORMATS.find((entry) => entry.value === format)?.hint)}>
              <OptionGroup
                ariaLabel={t("Format du manifeste")}
                value={format}
                onChange={setFormat}
                options={FORMATS}
              />
            </Field>
            <Field label={t("Portée")} full>
              <CheckOption
                checked={includeHidden}
                onChange={setIncludeHidden}
                label={t("Inclure les fichiers cachés")}
              />
            </Field>
          </Fieldset>

          {legacy && (
            <Callout tone="warning" title={t("{label} n'est plus un algorithme de sécurité", { label: legacy.label })}>
              {tx(legacy.hint)}
            </Callout>
          )}

          <Callout tone="neutral" title={t("Ce que FourTout va écrire")}>
            <Trans source={"Un fichier texte, une ligne par fichier :<0>e3b0c442…  documents/rapport.txt</0>À l'étape suivante, la boîte de dialogue du système vous demandera <1>où enregistrer ce fichier</1>."} components={[<code className="mt-1 block font-mono text-[11px]" />, <strong />]} />
          </Callout>

          <RunBar
            label={t("Créer le manifeste…")}
            icon="ListChecks"
            running={action.job.isRunning}
            progress={action.job.progress}
            status={action.job.status}
            error={tx(action.error)}
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
              { label: t("Fichiers"), value: action.result.files },
              { label: t("Volume"), value: formatFileSize(action.result.bytes) },
              { label: t("Algorithme"), value: action.result.algorithm },
              {
                label: t("Erreurs"),
                value: action.result.errors.length,
                tone: action.result.errors.length > 0 ? "danger" : "neutral",
              },
            ]}
          />
          <Callout
            tone="success"
            title={t("Manifeste enregistré")}
            actions={
              <Button size="sm" onClick={() => revealFile(action.result!.output)}>
                <Icon name="FolderTree" size={13} />{" "}{t("Ouvrir l'emplacement")}
              </Button>
            }
          >
            <span className="block">
              <Trans source={"Emplacement : <0>{output}</0>"} values={{ output: action.result.output }} components={[<code className="font-mono" />]} />
            </span>
            <span className="mt-0.5 block">
              <Trans source={"Il décrit {files} fichier(s) du dossier <0>{value}</0>."} values={{ files: action.result.files, value: root[0] }} components={[<code className="font-mono" />]} />
            </span>
          </Callout>

          {/* La suite logique, sans resélection : on vient d'écrire ce
              manifeste, et on sait déjà à quelle racine il se rapporte. */}
          <div className="flex flex-wrap items-center gap-2" data-testid="manifest-handoff">
            <Trans source={"<0>Et maintenant</0>"} components={[<span className="ft-label" />]} />
            <Button
              size="sm"
              variant="primary"
              onClick={() => onVerify(action.result!.output, root[0])}
            >
              <Icon name="ShieldCheck" size={13} />{" "}{t("Vérifier ce manifeste")}
            </Button>
          </div>
          {action.result.legacyWarning && (
            <Callout tone="warning" title={t("Algorithme hérité")}>
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
      <Callout tone="neutral" title={t("Comment ces deux champs se combinent")}>
        <span className="block">
          <Trans source={"Un manifeste contient des chemins <0>relatifs</0> :"} components={[<strong />]} />
        </span>
        <Trans source={"<0>e3b0c442…&nbsp;&nbsp;docs/readme.txt</0>"} components={[<code className="mt-1 block font-mono text-[11px]" />]} />
        <span className="mt-1 block">
          <Trans source={"Avec la racine <0>/home/vous/projet/</0>, FourTout vérifiera donc <1>/home/vous/projet/docs/readme.txt</1>."} components={[<code className="font-mono" />, <code className="font-mono" />]} />
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
          label={t("1. Le fichier de checksums")}
          hint={t("un .sha256, .sha512, .sha1, .md5 — ou le JSON écrit par FourTout")}
          filters={[
            {
              name: t("Manifestes d'empreintes"),
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
          label={t("2. Le dossier contenant les fichiers")}
          hint={t("la racine à laquelle les chemins du manifeste se rapportent")}
        />
      </div>

      {ready && (
        <RunBar
          label={t("Vérifier")}
          icon="ShieldCheck"
          running={action.job.isRunning}
          progress={action.job.progress}
          status={action.job.status}
          error={tx(action.error)}
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
              { label: t("Intacts"), value: report.ok, tone: "ok" },
              { label: t("Modifiés"), value: report.mismatched, tone: report.mismatched > 0 ? "danger" : "neutral" },
              { label: t("Manquants"), value: report.missing, tone: report.missing > 0 ? "danger" : "neutral" },
              { label: t("Illisibles"), value: report.unreadable, tone: report.unreadable > 0 ? "warn" : "neutral" },
              { label: t("Refusés"), value: report.refused, tone: report.refused > 0 ? "danger" : "neutral" },
            ]}
          />

          {checksumsAreValid(report) ? (
            <Callout tone="success" title={t("Tout correspond — {algorithm}", { algorithm: report.algorithm })}>
              {t("Les {ok} fichiers du manifeste sont présents et inchangés.", { ok: report.ok })}
            </Callout>
          ) : (
            <Callout tone="error" title={t("Le dossier ne correspond plus au manifeste")}>
              {t("Le détail figure ci-dessous, fichier par fichier.")}
            </Callout>
          )}

          {report.refused > 0 && (
            <Callout tone="error" title={t("Entrées refusées pour raison de sécurité")}>
              {t("Ce manifeste contient des chemins qui sortiraient du dossier vérifié (« ../ » ou chemin absolu). FourTout ne les a pas suivis : un fichier de checksums reçu de l'extérieur est une donnée, pas une instruction.")}
            </Callout>
          )}

          {report.legacyWarning && (
            <Callout tone="warning" title={t("Algorithme hérité")}>
              {report.legacyWarning}
            </Callout>
          )}

          {problems.length > 0 && (
            <Panel title={t("Fichiers en défaut")} count={problems.length}>
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
                        {tx(STATUS_LABEL[entry.status])}
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
