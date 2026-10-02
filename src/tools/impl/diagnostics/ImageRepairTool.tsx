import { useCallback, useEffect, useState } from "react";
import { Callout } from "@/components/ui/Callout";
import { DiagnosticShell, StructureTable, type ActionOutcome } from "@/components/diagnostics/DiagnosticShell";
import {
  fixExtension,
  imageRecover,
  outputPath,
  type DiagnosticReport,
  type RepairAction,
} from "@/core/diagnostics/native";
import { formatSize } from "@/core/disks/native";
import { readBytes } from "@/core/files/native";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, t, tx } from "@/i18n";

/**
 * Image endommagée.
 *
 * PNG et JPEG se lisent par le début, ce qui change tout : une image dont la
 * fin manque garde ses premières lignes. C'est la base de ce que cet outil
 * appelle une **récupération visuelle** — les pixels que le décodeur accepte de
 * rendre sont réencodés dans un fichier sain, et rien d'autre n'est promis.
 *
 * Deux gestes sont refusés, et leur refus est la raison d'être de l'outil :
 * recalculer une somme de contrôle abîmée, ce qui masquerait la corruption sans
 * rien réparer ; et inventer les lignes manquantes d'une image tronquée.
 */
export function ImageRepairTool({ tool }: ToolComponentProps) {
  const handed = useHandoffPaths(tool.id);

  const run = useCallback(
    async (action: RepairAction, report: DiagnosticReport): Promise<ActionOutcome> => {
      if (action.id === "fix-extension") {
        const output = await fixExtension(report.path);
        return {
          title: t("Copie créée avec la bonne extension"),
          tone: "success",
          summary:
            t("Le contenu n'a pas été touché : c'est une copie octet pour octet, sous un nom qui dit enfin ce qu'elle contient."),
          kept: [t("Tous les octets de l'image, à l'identique")],
          lost: [],
          output,
        };
      }

      const destination = await outputPath(report.path, "recuperee", "png");
      const result = await imageRecover(report.path, destination);

      return {
        title: result.lossless ? t("Image réécrite sans perte") : t("Récupération visuelle"),
        tone: result.lossless ? "success" : "warning",
        summary: result.lossless
          ? t("Les octets des pixels ont été recopiés tels quels : l'image produite est rigoureusement identique à l'originale, débarrassée de ce qui ne faisait pas partie d'elle. {width} × {height} pixels.", { width: result.width, height: result.height })
          : t("Les pixels que le décodeur accepte de rendre ont été réencodés en PNG sans perte. C'est l'image qui est sauvée, pas le fichier d'origine : {width} × {height} pixels. Ce n'est pas une réparation — le fichier produit est un nouveau fichier, pas l'ancien remis d'aplomb.", { width: result.width, height: result.height }),
        kept: [
          `${result.width} × ${result.height} pixels`,
          ...result.steps,
          t("Sortie PNG sans perte, {size}", { size: formatSize(result.outputSize) }),
        ],
        lost: result.lossless
          ? [t("Les métadonnées portées par les blocs écartés")]
          : [
              t("Métadonnées, profil de couleur et miniatures d'origine"),
              t("Les lignes que le décodeur n'a pas rendues, s'il en manquait"),
            ],
        output: destination,
        extra: <BeforeAfter source={report.path} output={destination} />,
      };
    },
    [],
  );

  return (
    <DiagnosticShell
      label={t("Image PNG ou JPEG")}
      hint={t("Même une image que votre visionneuse refuse d'afficher.")}
      filters={[{ name: t("Images"), extensions: ["png", "jpg", "jpeg"] }]}
      initialPath={handed[0]}
      onAction={run}
      wrongFormat={(report) =>
        report.detected === "png" || report.detected === "jpg"
          ? undefined
          : t("Ce fichier est du {detectedLabel}. Cet outil analyse la structure interne du PNG et du JPEG ; pour le reste, le diagnostic universel s'applique.", { detectedLabel: report.detectedLabel })
      }
      structure={(report) => {
        const image = report.details.image;
        if (!image) return null;
        return (
          <>
            <StructureTable
              caption={t("Structure de l'image")}
              rows={[
                { label: t("Format réel"), value: report.detectedLabel },
                {
                  label: t("Dimensions"),
                  value:
                    image.width && image.height ? `${image.width} × ${image.height} pixels` : "illisibles",
                },
                {
                  label: t("Le décodeur accepte-t-il le fichier ?"),
                  value: image.decodes ? "oui" : t("non — {value}", { value: image.decodeError ?? "raison inconnue" }),
                },
                {
                  label: t("Marque de fin"),
                  value: image.endMarker ? t("présente") : "absente",
                },
                {
                  label: t("Octets après l'image"),
                  value: image.trailingBytes > 0 ? formatSize(image.trailingBytes) : "aucun",
                },
                ...(image.format === "png"
                  ? [
                      { label: t("Blocs lus"), value: String(image.chunks.length) },
                      {
                        label: t("Blocs essentiels abîmés"),
                        value: String(image.brokenCritical),
                      },
                      {
                        label: t("Blocs auxiliaires abîmés"),
                        value: String(image.brokenAncillary),
                      },
                    ]
                  : [{ label: t("Segments lus"), value: String(image.segments.length) }]),
              ]}
            />

            {image.format === "png" && image.chunks.length > 0 && (
              <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
                <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
                  {t("Blocs PNG")}
                </h3>
                <div className="max-h-64 overflow-auto">
                  <table className="ft-table">
                    <thead>
                      <tr>
                        <th scope="col">{t("Bloc")}</th>
                        <th scope="col">{t("Rôle")}</th>
                        <th scope="col" className="text-right">
                          {t("Taille")}
                        </th>
                        <th scope="col">{t("Somme de contrôle")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {image.chunks.map((chunk) => (
                        <tr key={`${chunk.offset}-${chunk.kind}`}>
                          <th scope="row" className="ft-value font-normal">
                            {chunk.kind}
                          </th>
                          <td className="ft-value">
                            {chunk.ancillary ? "auxiliaire" : "essentiel"}
                          </td>
                          <td className="ft-value text-right tabular-nums">{chunk.length}</td>
                          <td
                            className={`ft-value ${
                              chunk.crcValid ? "" : "text-[var(--ft-danger)] font-medium"
                            }`}
                          >
                            {chunk.crcValid ? "valide" : "fausse"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {image.format === "jpg" && image.segments.length > 0 && (
              <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
                <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
                  {t("Segments JPEG")}
                </h3>
                <ul className="ft-meta max-h-64 divide-y divide-[var(--ft-rule)] overflow-auto">
                  {image.segments.map((segment) => (
                    <li key={`${segment.offset}-${segment.marker}`} className="px-3 py-1">
                      <Trans source={"<0>{label}</0> · octet {offset}{value}"} values={{ label: segment.label, offset: segment.offset, value: segment.length > 0 && ` · ${segment.length} octets` }} components={[<span className="ft-value" />]} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        );
      }}
    />
  );
}

/**
 * Aperçu avant / après.
 *
 * Les URL d'objet sont révoquées au démontage : une vue de réparation qui
 * laisse traîner des objets binaires fait grossir la mémoire à chaque essai.
 */
function BeforeAfter({ source, output }: { source: string; output: string }) {
  const [urls, setUrls] = useState<{ before?: string; after?: string }>({});
  const [note, setNote] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];

    const load = async (path: string) => {
      try {
        const bytes = await readBytes(path);
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
        created.push(url);
        return url;
      } catch {
        return undefined;
      }
    };

    void (async () => {
      const before = await load(source);
      const after = await load(output);
      if (cancelled) return;
      setUrls({ before, after });
      if (!before) {
        setNote(t("L'aperçu de la source n'a pas pu être construit : le fichier reste illisible."));
      }
    })();

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [source, output]);

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <figure className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-2">
          <figcaption className="ft-section mb-1">{t("Source")}</figcaption>
          {urls.before ? (
            <img src={urls.before} alt={t("Fichier d'origine")} className="max-h-64 w-full object-contain" />
          ) : (
            <p className="ft-meta">{t("Non affichable.")}</p>
          )}
        </figure>
        <figure className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-2">
          <figcaption className="ft-section mb-1">{t("Résultat")}</figcaption>
          {urls.after ? (
            <img src={urls.after} alt={t("Image récupérée")} className="max-h-64 w-full object-contain" />
          ) : (
            <p className="ft-meta">{t("Non affichable.")}</p>
          )}
        </figure>
      </div>
      {note && <Callout tone="info">{tx(note)}</Callout>}
    </div>
  );
}
