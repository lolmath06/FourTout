import { useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { Panel } from "@/components/files/Summary";
import { CheckOption } from "@/components/text/TextToolShell";
import { Callout } from "@/components/ui/Callout";
import { formatFileSize } from "@/core/files";
import { toHexLines, formatOffset } from "@/core/files/hex";
import {
  fileInfo,
  hashFiles,
  readHex,
  type FileHashes,
  type FileInfo,
  type HashAlgorithm,
} from "@/core/files/native";
import { detectEncoding, ENCODING_LABELS, type TextEncodingId } from "@/core/text/encoding";
import { DIAGNOSTIC_SPECIALISTS, HANDOFF_TARGETS, specialistFor } from "@/features/handoff/targets";
import { OpenToolButton } from "@/features/handoff/openTool";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, formatDateTime, formatNumber, t, tx } from "@/i18n";

/**
 * Fiche d'identité complète d'un fichier.
 *
 * Elle croise trois sources, et le contraste entre elles est tout l'intérêt de
 * l'outil : ce que le **nom** prétend (extension, type MIME), ce que les
 * **premiers octets** révèlent (signature), et ce que le **contenu** dit quand
 * c'est du texte (encodage, BOM, fins de ligne). Un `.jpg` qui commence par
 * `%PDF-` est signalé — c'est exactement ce qui explique qu'un fichier « ne
 * s'ouvre pas ».
 *
 * Rien n'est corrigé automatiquement : renommer un fichier d'après ce qu'on
 * croit avoir deviné est le genre d'initiative qui casse une bibliothèque de
 * photos entière. La correction reste une action que l'utilisateur demande.
 *
 * Les moteurs sont ceux déjà en place : informations natives, empreintes en
 * flux, détection d'encodage de la phase 8, lecture hexadécimale par fenêtre.
 */
interface Inspection {
  info: FileInfo;
  hashes?: FileHashes;
  head: number[];
  encoding?: {
    id: TextEncodingId;
    certain: boolean;
    confidence: number;
    reason: string;
    bom: string;
    newline: string;
  };
}

const ALGORITHMS: { value: HashAlgorithm; label: string; legacy?: boolean }[] = [
  { value: "sha256", label: "SHA-256" },
  { value: "sha512", label: "SHA-512" },
  { value: "sha1", label: "SHA-1", legacy: true },
  { value: "md5", label: "MD5", legacy: true },
];

/** Nombre d'octets montrés dans l'aperçu hexadécimal de la fiche. */
const HEAD_BYTES = 128;

export function FileInspectTool({ tool }: ToolComponentProps) {
  const received = useHandoffPaths(tool.id);
  const [paths, setPaths] = useState<string[]>(received);
  const [algorithms, setAlgorithms] = useState<HashAlgorithm[]>(["sha256"]);

  const toggle = (algorithm: HashAlgorithm) =>
    setAlgorithms((current) =>
      current.includes(algorithm)
        ? current.filter((entry) => entry !== algorithm)
        : [...current, algorithm],
    );

  return (
    <NativeToolShell<Inspection>
      picker={{
        mode: "files",
        paths,
        onChange: setPaths,
        label: t("Choisissez un fichier à inspecter"),
      }}
      actionLabel={t("Inspecter le fichier")}
      actionIcon="FileSearch"
      run={async (context) => {
        const info = await fileInfo(paths[0]);
        if (info.isDir) return { info, head: [] };

        const window = await readHex(paths[0], 0, Math.min(HEAD_BYTES * 4, info.size || 1));
        const head = window.bytes;

        let encoding: Inspection["encoding"];
        if (info.looksLikeText && head.length > 0) {
          // Le moteur d'encodage de la phase 8 travaille sur des octets : on
          // lui donne la même fenêtre que celle affichée, plutôt que d'ouvrir
          // le fichier une seconde fois.
          const detection = detectEncoding(Uint8Array.from(head));
          encoding = {
            id: detection.encoding,
            certain: detection.certain,
            confidence: detection.confidence,
            reason: detection.reason,
            bom: detection.bom === "none" ? t("aucun") : detection.bom.toUpperCase(),
            newline: detection.newline.dominant,
          };
        }

        const hashes =
          algorithms.length > 0
            ? (await hashFiles([paths[0]], algorithms, context))[0]
            : undefined;
        return { info, hashes, head, encoding };
      }}
      renderResult={(inspection) => <Report inspection={inspection} />}
    >
      <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3">
        <p className="ft-label mb-1">{t("Empreintes à calculer")}</p>
        <div className="grid gap-0.5 sm:grid-cols-2">
          {ALGORITHMS.map((algorithm) => (
            <CheckOption
              key={algorithm.value}
              checked={algorithms.includes(algorithm.value)}
              onChange={() => toggle(algorithm.value)}
              label={tx(algorithm.label)}
              hint={
                algorithm.legacy
                  ? t("Hérité : utile pour vérifier une empreinte publiée autrefois, inadapté à la sécurité.")
                  : undefined
              }
            />
          ))}
        </div>
      </div>
    </NativeToolShell>
  );
}

function Report({ inspection }: { inspection: Inspection }) {
  const { info, hashes, head, encoding } = inspection;
  const lines = toHexLines(head.slice(0, HEAD_BYTES), 0);
  // L'outil proposé vient de la **famille détectée**, jamais de l'extension :
  // un « .jpg » qui contient un PNG doit mener au convertisseur d'image.
  const specialist = specialistFor(info.family, info.magic);
  // Un fichier qui « ne s'ouvre pas » amène ici avant tout : l'inspecteur dit
  // ce qu'il est, le diagnostic dit ce qui lui manque. Quand un outil connaît
  // le format en profondeur, c'est lui qu'on propose plutôt que le généraliste.
  const diagnosis = DIAGNOSTIC_SPECIALISTS[info.magic]?.tool ?? HANDOFF_TARGETS.fileDiagnose;

  return (
    <div className="space-y-3" data-testid="file-inspect">
      {!info.extensionMatches && (
        <Callout tone="warning" title={t("L'extension ne correspond pas au contenu")}>
          <span className="block">
            <Trans source={"Extension : <0>{value}</0> — Type détecté : <1>{magicLabel}</1>."} values={{ value: info.extension.toUpperCase() || t("aucune"), magicLabel: info.magicLabel }} components={[<strong />, <strong />]} />
          </span>
          <Trans source={"<0>Le fichier a sans doute été renommé. FourTout ne le renomme pas de lui-même : sur une bibliothèque entière, une correction automatique fondée sur une supposition fait plus de dégâts qu'un nom trompeur. Le bouton « Renommer ce fichier » ouvre le renommage par lot avec ce fichier déjà chargé.</0>"} components={[<span className="mt-1 block" />]} />
        </Callout>
      )}

      {/* Les outils qui savent traiter ce contenu, avec le fichier transmis. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="inspect-handoffs">
        <Trans source={"<0>Continuer avec</0>"} components={[<span className="ft-label" />]} />
        <OpenToolButton toolId={HANDOFF_TARGETS.preview} paths={[info.path]} variant="primary" />
        {specialist && <OpenToolButton toolId={specialist} paths={[info.path]} />}
        <OpenToolButton toolId={diagnosis} paths={[info.path]} label={t("Diagnostiquer")} />
        {info.family === "archive" && info.magic !== "gz" && info.magic !== "xz" && (
          <OpenToolButton toolId={HANDOFF_TARGETS.archiveTest} paths={[info.path]} />
        )}
        <OpenToolButton toolId={HANDOFF_TARGETS.hexEdit} paths={[info.path]} />
        {!info.extensionMatches && (
          <OpenToolButton
            toolId={HANDOFF_TARGETS.rename}
            paths={[info.path]}
            label={t("Renommer ce fichier")}
          />
        )}
      </div>

      <Panel title={t("Identité")}>
        <dl className="grid gap-x-4 gap-y-1 p-3 text-xs sm:grid-cols-[14rem_1fr]">
          <Row label={t("Nom")} value={info.name} />
          <Row label={t("Emplacement")} value={info.path} mono />
          <Row label={t("Type")} value={info.isDir ? t("Dossier") : t("Fichier")} />
          <Row
            label={t("Taille")}
            value={t("{size} ({bytes} {count, plural, one {octet} other {octets}})", {
              size: formatFileSize(info.size),
              bytes: formatNumber(info.size),
              count: info.size,
            })}
          />
          <Row label={t("Extension")} value={info.extension || "—"} mono />
          <Row label={t("Type MIME (d'après l'extension)")} value={info.mime} mono />
          <Row
            label={t("Type réel (d'après les premiers octets)")}
            value={info.magic === "inconnu" ? t("non reconnu") : `${info.magicLabel} (${info.magic})`}
          />
          <Row
            label={t("Extension cohérente")}
            value={info.extensionMatches ? t("oui") : t("non — voir l'avertissement ci-dessus")}
          />
          <Row label={t("Famille")} value={info.family} />
          <Row label={t("Modifié le")} value={formatDate(info.modified)} />
          <Row label={t("Créé le")} value={formatDate(info.created)} />
          <Row label={t("Dernier accès")} value={formatDate(info.accessed)} />
          <Row label={t("Lecture seule")} value={info.readOnly ? t("oui") : t("non")} />
          <Row label={t("Lien symbolique")} value={info.isSymlink ? t("oui") : t("non")} />
        </dl>
      </Panel>

      {encoding && (
        <Panel title={t("Contenu texte")}>
          <dl className="grid gap-x-4 gap-y-1 p-3 text-xs sm:grid-cols-[14rem_1fr]">
            <Row
              label={t("Encodage")}
              value={
                encoding.certain
                  ? t("{encoding} (certain : le fichier le déclare)", {
                      encoding: ENCODING_LABELS[encoding.id],
                    })
                  : t("{encoding} (hypothèse, {confidence} %)", {
                      encoding: ENCODING_LABELS[encoding.id],
                      confidence: Math.round(encoding.confidence * 100),
                    })
              }
            />
            <Row label={t("Marque d'ordre des octets (BOM)")} value={encoding.bom} />
            <Row label={t("Fins de ligne")} value={encoding.newline.toUpperCase()} />
            <Row label={t("Ce qui a emporté la décision")} value={encoding.reason} />
          </dl>
        </Panel>
      )}

      {hashes && hashes.digests.length > 0 && (
        <Panel title={t("Empreintes")}>
          <dl className="grid gap-x-4 gap-y-1 p-3 text-xs sm:grid-cols-[14rem_1fr]">
            {hashes.digests.map(([label, digest]) => (
              <Row key={label} label={tx(label)} value={digest} mono />
            ))}
          </dl>
        </Panel>
      )}

      {lines.length > 0 && (
        <Panel title={t("Premiers octets ({value} sur {value2})", { value: Math.min(head.length, HEAD_BYTES), value2: formatNumber(info.size) })}>
          <pre className="overflow-x-auto px-3 py-2 font-mono text-[11px] leading-5">
            {lines.map((line) => (
              <div key={line.offset}>
                <span className="text-[var(--ft-text-faint)]">{formatOffset(line.offset)}</span>
                {"  "}
                <span>{line.hex.join(" ").padEnd(47, " ")}</span>
                {"  "}
                <span className="text-[var(--ft-text-muted)]">{line.ascii}</span>
              </div>
            ))}
          </pre>
        </Panel>
      )}

    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="contents">
      <dt className="text-[var(--ft-text-muted)]">{tx(label)}</dt>
      <dd className={mono ? "break-all font-mono" : "break-words"}>{value}</dd>
    </div>
  );
}

function formatDate(milliseconds: number): string {
  if (!milliseconds) return "—";
  return formatDateTime(new Date(milliseconds));
}
