import { useMemo, useState } from "react";
import { toolName } from "@/core/tools/localized";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { FileDropZone } from "@/components/files/FileDropZone";
import { ValueTable } from "@/components/calc/CalcShell";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { formatFileSize, kindOfExtension, type SelectedFile } from "@/core/files";
import { useJob } from "@/core/jobs";
import { isMediaAvailable, runMedia } from "@/core/media/client";
import { stripMediaMetadata } from "@/core/media/operations/video";
import { outputName } from "@/core/pdf/filenames";
import { toolRegistry } from "@/core/tools/registry";
import { toolRoute, type DataKind } from "@/core/tools/types";
import { setHandoff } from "@/features/handoff/store";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, localized, t, tx } from "@/i18n";

/**
 * Centre de nettoyage des métadonnées.
 *
 * L'outil identifie le fichier puis fait **la seule chose honnête** pour son
 * type :
 *
 *  - image et PDF : il ouvre l'outil spécialisé, déjà chargé. Écrire ici un
 *    second nettoyeur EXIF garantirait deux comportements divergents pour la
 *    même promesse ;
 *  - audio et vidéo : il exécute lui-même la recopie sans métadonnées, parce
 *    que c'est un seul appel FFmpeg et qu'il n'existe pas d'écran dédié ;
 *  - tout le reste : il le dit, et ne produit rien.
 *
 * Sa valeur tient dans la dernière ligne : un outil qui laisserait croire
 * qu'un `.docx` est anonymisé alors que rien n'est implémenté serait pire
 * qu'un outil absent.
 */
interface Capability {
  /** Outil spécialisé à ouvrir, quand il en existe un. */
  toolId?: string;
  /** Ce qui est réellement retiré. */
  removes: string[];
  /** Ce qui subsiste malgré le nettoyage. */
  keeps: string[];
}

const CAPABILITIES: Partial<Record<DataKind, Capability>> = localized(() => ({
  image: {
    toolId: "image-metadata-strip",
    removes: [
      t("EXIF : appareil, objectif, réglages de prise de vue"),
      t("Coordonnées GPS et altitude"),
      t("Date et heure de la prise de vue"),
      t("Profils IPTC et XMP, logiciel de retouche"),
      t("Vignette intégrée, qui peut montrer l'image avant retouche"),
    ],
    keeps: [
      t("Ce qui est visible dans l'image (horodatage incrusté, plaque, visage)"),
      t("Le nom du fichier"),
    ],
  },
  pdf: {
    toolId: "pdf-metadata",
    removes: [
      t("Titre, auteur, sujet, mots-clés"),
      t("Logiciel créateur et producteur"),
      t("Dates de création et de modification"),
    ],
    keeps: [
      t("Le texte et les images du document"),
      t("Les métadonnées des images incluses dans le PDF"),
      t("Le contenu masqué que le producteur du fichier aurait laissé"),
    ],
  },
  video: {
    removes: [
      t("Titre, auteur, logiciel d'encodage, commentaires"),
      t("Date d'enregistrement"),
      t("Coordonnées GPS des vidéos de téléphone"),
      "Chapitres",
    ],
    keeps: [t("L'image et le son, recopiés sans réencodage ni perte de qualité")],
  },
  audio: {
    removes: [
      t("Étiquettes ID3 : titre, artiste, album, année, commentaires"),
      t("Logiciel d'encodage"),
      t("Pochette intégrée"),
    ],
    keeps: [t("Le son, recopié sans réencodage ni perte de qualité")],
  },
}));

/** Types pour lesquels FourTout n'a pas de nettoyeur, et le dit. */
const UNSUPPORTED: Partial<Record<DataKind, string>> = {
  document:
    "FourTout ne sait pas nettoyer les métadonnées d'un document bureautique (.docx, .odt, .xlsx). " +
    "Elles contiennent souvent l'auteur, l'organisation et l'historique des révisions. " +
    "LibreOffice le fait : Fichier → Propriétés → Réinitialiser les propriétés.",
  archive:
    "Une archive ne porte pas de métadonnées propres, mais les fichiers qu'elle contient en ont : " +
    "extrayez-la, nettoyez les fichiers un par un, puis recréez l'archive.",
};

const KIND_LABELS: Partial<Record<DataKind, string>> = localized(() => ({
  image: "Image",
  pdf: "Document PDF",
  video: t("Vidéo"),
  audio: "Audio",
  document: t("Document bureautique"),
  archive: "Archive",
  text: t("Texte"),
  data: t("Données"),
}));

export function MetadataStripTool(_props: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const navigate = useNavigate();
  const job = useJob<OperationOutcome>();
  const file = files[0];

  const analysis = useMemo(() => {
    if (!file) return undefined;
    const kind = kindOfExtension(file.extension);
    const capability = CAPABILITIES[kind];
    const target = capability?.toolId ? toolRegistry.get(capability.toolId) : undefined;
    // Un outil spécialisé annoncé mais absent du registre est une promesse en
    // l'air : on préfère ne rien proposer que router vers une page inexistante.
    const usable = capability && (!capability.toolId || target !== undefined);
    return {
      kind,
      capability: usable ? capability : undefined,
      target,
      unsupported: UNSUPPORTED[kind],
    };
  }, [file]);

  const openSpecialised = () => {
    if (!analysis?.capability?.toolId || !file) return;
    setHandoff({ toolId: analysis.capability.toolId, files: [file] });
    navigate(toolRoute(analysis.capability.toolId));
  };

  const stripMedia = async () => {
    if (!file) return;
    setOutcome(null);
    const result = await job.run(async (context) => {
      if (!(await isMediaAvailable())) {
        throw new Error(
          t("Le moteur média (FFmpeg) n'est pas disponible : le nettoyage audio et vidéo nécessite l'application FourTout installée."),
        );
      }
      // Le conteneur de sortie est celui d'entrée : on ne réencode rien, donc
      // changer d'emballage n'aurait aucun sens et risquerait de perdre une piste.
      const container = (file.extension || "mp4").toLowerCase();
      const produced = await runMedia(
        {
          files: [file],
          operation: stripMediaMetadata(container, file.mimeType || "application/octet-stream"),
          outputName: outputName(file.name, "sans-metadonnees", container),
          label: t("Recopie sans métadonnées…"),
        },
        context,
      );
      return {
        files: [produced],
        summary:
          t("Pistes recopiées à l'identique, métadonnées et chapitres retirés. Aucun réencodage : la qualité d'origine est conservée."),
      } satisfies OperationOutcome;
    });
    if (result) setOutcome(result);
  };

  const error = job.status === "error" && job.error ? job.error.message : undefined;

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={{ inputs: [], maxFiles: 1 }}
        files={files}
        onChange={(next) => {
          setFiles(next);
          setOutcome(null);
        }}
        label={t("Déposez le fichier à nettoyer")}
        hint={t("Image, PDF, audio ou vidéo. FourTout identifie ce qu'il sait retirer.")}
        disabled={job.isRunning}
      />

      {file && analysis && (
        <>
          <ValueTable
            caption={t("Fichier analysé")}
            rows={[
              { label: t("Nom"), value: file.name },
              { label: t("Type détecté"), value: KIND_LABELS[analysis.kind] ?? analysis.kind },
              { label: t("Taille"), value: formatFileSize(file.size) },
            ]}
          />

          {analysis.capability ? (
            <>
              <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
                <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
                  {t("Ce que FourTout peut retirer")}
                </h3>
                <ul className="divide-y divide-[var(--ft-rule)]">
                  {analysis.capability.removes.map((entry) => (
                    <li key={entry} className="ft-row-py flex items-start gap-2 px-3 text-[13px]">
                      <Icon name="Check" size={13} className="mt-0.5 shrink-0 text-[var(--ft-ok)]" />
                      {entry}
                    </li>
                  ))}
                </ul>
                <h3 className="ft-section border-y border-[var(--ft-rule)] px-3 py-1.5">
                  {t("Ce qui subsiste")}
                </h3>
                <ul className="divide-y divide-[var(--ft-rule)]">
                  {analysis.capability.keeps.map((entry) => (
                    <li key={entry} className="ft-row-py flex items-start gap-2 px-3 text-[13px]">
                      <Icon
                        name="Info"
                        size={13}
                        className="mt-0.5 shrink-0 text-[var(--ft-text-faint)]"
                      />
                      {entry}
                    </li>
                  ))}
                </ul>
              </section>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ft-rule)] pt-3">
                {analysis.target ? (
                  <>
                    <p className="ft-meta">
                      {t("Le nettoyage est réalisé par l'outil spécialisé, avec votre fichier déjà chargé.")}
                    </p>
                    <Button size="md" variant="primary" onClick={openSpecialised}>
                      <Icon name={analysis.target.icon} size={15} />
                      {t("Ouvrir « {name} »", { name: toolName(analysis.target) })}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="ft-meta">
                      {t("Les pistes sont recopiées telles quelles : aucun réencodage, aucune perte.")}
                    </p>
                    <div className="flex items-center gap-2">
                      {job.isRunning && (
                        <Button size="sm" variant="ghost" onClick={job.cancel}>
                          {t("Annuler")}
                        </Button>
                      )}
                      <Button
                        size="md"
                        variant="primary"
                        onClick={() => void stripMedia()}
                        disabled={job.isRunning}
                      >
                        <Icon
                          name={job.isRunning ? "Loader" : "EyeOff"}
                          size={15}
                          className={job.isRunning ? "animate-spin" : undefined}
                        />
                        {job.isRunning ? t("Nettoyage…") : t("Retirer les métadonnées")}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <Callout tone="warning" title={t("Pas de nettoyage pour ce type de fichier")}>
              {analysis.unsupported ??
                t("FourTout ne dispose d'aucun nettoyeur de métadonnées pour ce type de fichier. Plutôt que de produire une copie qui aurait l'air propre sans l'être, l'outil préfère ne rien faire.")}
            </Callout>
          )}
        </>
      )}

      {job.isRunning && <ProgressBar ratio={job.progress.ratio} label={tx(job.progress.label)} />}

      {error && (
        <Callout tone="error" title={t("L'opération a échoué")}>
          {tx(error)}
        </Callout>
      )}

      {outcome && <ResultPanel outcome={outcome} />}

      <Callout tone="info" title={t("Ce que « supprimer les métadonnées » veut dire")}>
        <Trans source={"Les métadonnées sont les informations <0>autour</0> du contenu : appareil photo, position GPS, auteur, logiciel, dates. Les retirer ne modifie pas ce qu'on voit ou ce qu'on entend — et ne retire donc rien de ce qui est visible <1>dans</1> le fichier lui-même."} components={[<em />, <em />]} />
      </Callout>
    </div>
  );
}
