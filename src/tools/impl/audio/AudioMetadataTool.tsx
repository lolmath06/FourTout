import { useEffect, useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, TextInput } from "@/components/pdf/Field";
import { Callout } from "@/components/ui/Callout";
import { probeJson, runMedia } from "@/core/media/client";
import { inspectMedia, type MediaDetails } from "@/core/media/inspect";
import { TAG_FIELDS, writeTags, type AudioTags } from "@/core/media/operations/audio";
import { AUDIO_MIME } from "@/core/media/types";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Lire et corriger les étiquettes d'un fichier audio.
 *
 * L'écriture passe par `-c copy` : le flux est recopié tel quel, le son produit
 * est identique au bit près, et l'opération prend une fraction de seconde quelle
 * que soit la durée. Réencoder pour rectifier un titre mal orthographié
 * dégraderait le fichier un peu plus à chaque passage — un prix absurde pour une
 * chaîne de caractères.
 */
export function AudioMetadataTool({ tool }: ToolComponentProps) {
  const [tags, setTags] = useState<AudioTags>({});
  const [loaded, setLoaded] = useState<string | undefined>();
  const [details, setDetails] = useState<MediaDetails | undefined>();

  const set = (key: keyof AudioTags, value: string) =>
    setTags((current) => ({ ...current, [key]: value }));

  return (
    <MediaToolShell
      tool={tool}
      actionLabel="Enregistrer les étiquettes"
      hint="Le son n'est pas réencodé : seules les étiquettes changent."
      run={async ({ files, context }) => {
        const extension = (files[0].extension || "mp3").toLowerCase();
        const file = await runMedia(
          {
            files: [files[0]],
            operation: writeTags(tags, extension, AUDIO_MIME[extension] ?? "application/octet-stream"),
            outputName: files[0].name,
            label: "Écriture des étiquettes…",
          },
          context,
        );
        const written = TAG_FIELDS.filter(({ key }) => tags[key] !== undefined).length;
        return {
          files: [file],
          summary: `${written} étiquette${written > 1 ? "s" : ""} écrite${written > 1 ? "s" : ""}, sans réencodage du son.`,
        };
      }}
    >
      {(_infos, files) => (
        <TagEditor
          file={files[0]}
          tags={tags}
          setTag={set}
          loaded={loaded}
          onLoaded={(name, read, media) => {
            setLoaded(name);
            setTags(read);
            setDetails(media);
          }}
          details={details}
        />
      )}
    </MediaToolShell>
  );
}

function TagEditor({
  file,
  tags,
  setTag,
  loaded,
  onLoaded,
  details,
}: {
  file: SelectedFile;
  tags: AudioTags;
  setTag: (key: keyof AudioTags, value: string) => void;
  loaded?: string;
  onLoaded: (name: string, tags: AudioTags, details: MediaDetails) => void;
  details?: MediaDetails;
}) {
  const [error, setError] = useState<string | undefined>();

  // Les valeurs existantes sont préremplies : on corrige un champ sans effacer
  // les autres par omission.
  useEffect(() => {
    if (loaded === file.id) return;
    let cancelled = false;
    (async () => {
      try {
        const media = inspectMedia(await probeJson(file));
        if (cancelled) return;
        const read: AudioTags = {};
        for (const { key } of TAG_FIELDS) {
          const found = media.tags.find((tag) => tag.key === key);
          if (found) read[key] = found.value;
        }
        onLoaded(file.id, read, media);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, loaded, onLoaded]);

  return (
    <div className="space-y-3">
      {error && (
        <Callout tone="error" title="Étiquettes illisibles">
          {error}
        </Callout>
      )}

      {details?.hasCoverArt && (
        <Callout tone="info" title="Pochette embarquée">
          Ce fichier porte une image de couverture. Elle est conservée telle quelle : cet outil ne
          touche qu'aux étiquettes textuelles.
        </Callout>
      )}

      <Fieldset columns={2}>
        {TAG_FIELDS.map(({ key, label, placeholder }) => (
          <Field key={key} label={label} full={key === "comment"}>
            <TextInput
              value={tags[key] ?? ""}
              placeholder={placeholder}
              onChange={(event) => setTag(key, event.target.value)}
            />
          </Field>
        ))}
      </Fieldset>

      <p className="text-xs text-[var(--ft-text-muted)]">
        Un champ vidé est effacé du fichier produit. Pour consulter tout ce que le fichier déclare
        (codec, débit, disposition des canaux), passez par « Inspecter un média ».
      </p>
    </div>
  );
}
