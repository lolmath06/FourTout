import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, OptionGroup, Select } from "@/components/pdf/Field";
import { AudioPreview } from "@/components/media/AudioPreview";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { LocalProcessingNote } from "./ModelRequirements";
import { cleanMessage } from "./message";
import { countText, previewText } from "@/core/speech/segment";
import {
  formatDuration,
  synthesize,
  synthesizePreview,
  toAudioFile,
  TTS_VOICES,
  type AudioFormat,
  type VoiceId,
} from "@/core/speech/tts";
import { formatSize, type SpeechAsset } from "@/core/speech/models";
import {
  cancelSpeechJob,
  clearSpeechJob,
  speechJobResult,
  startSpeechJob,
  SPEECH_CANCELLED,
} from "@/features/jobs/speech";
import { useToolJob } from "@/features/jobs/hooks";
import { notify } from "@/features/notifications/store";
import type { ToolDefinition } from "@/core/tools/types";

/**
 * Atelier commun aux trois outils de lecture à voix haute (texte saisi, fichier
 * texte, PDF). Le texte arrive d'ailleurs mais reste modifiable avant synthèse,
 * et l'aperçu ne fabrique qu'une phrase : on n'attend jamais vingt minutes pour
 * juger d'une voix. La génération complète passe par le job global, donc elle
 * survit à la navigation.
 */

const SPEEDS = [
  { value: "0.8", label: "Lente" },
  { value: "1", label: "Normale" },
  { value: "1.25", label: "Rapide" },
  { value: "1.5", label: "Très rapide" },
] as const;

const FORMATS = [
  { value: "mp3" as const, label: "MP3" },
  { value: "wav" as const, label: "WAV" },
];

export interface TtsResult {
  file: { name: string; bytes: Uint8Array; mimeType: string };
  durationMs: number;
  segments: number;
  voiceLabel: string;
}

export function TtsWorkbench({
  tool,
  assets,
  text,
  onTextChange,
  baseName,
  textLabel = "Texte à lire",
  header,
  readOnlyNote,
}: {
  tool: ToolDefinition;
  assets: SpeechAsset[];
  text: string;
  onTextChange: (text: string) => void;
  baseName: string;
  textLabel?: string;
  header?: ReactNode;
  readOnlyNote?: string;
}) {
  const installedVoices = useMemo(
    () => TTS_VOICES.filter((voice) => assets.find((asset) => asset.id === voice.id)?.installed),
    [assets],
  );
  const [voiceId, setVoiceId] = useState<VoiceId>(installedVoices[0]?.id ?? "voice-fr-siwis");
  const [speed, setSpeed] = useState("1");
  const [format, setFormat] = useState<AudioFormat>("mp3");
  const [preview, setPreview] = useState<Uint8Array | undefined>(undefined);
  const [previewing, setPreviewing] = useState(false);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);

  const job = useToolJob(tool.id);
  const result = speechJobResult<TtsResult>(job?.status === "done" ? job.id : undefined);
  const running = job?.status === "running" || job?.status === "cancelling";
  const counts = countText(text);

  // Une voix désinstallée pendant la session ne doit pas rester sélectionnée.
  useEffect(() => {
    if (installedVoices.length > 0 && !installedVoices.some((voice) => voice.id === voiceId)) {
      setVoiceId(installedVoices[0].id);
    }
  }, [installedVoices, voiceId]);

  const voiceLabel = TTS_VOICES.find((voice) => voice.id === voiceId)?.label ?? "";

  const listen = async () => {
    const extract = previewText(text);
    if (!extract) {
      notify.warning("Rien à lire", "Saisissez d'abord un texte.");
      return;
    }
    setPreviewing(true);
    setPreview(undefined);
    try {
      const outcome = await synthesizePreview(extract, voiceId, Number(speed));
      setPreview(outcome.bytes);
    } catch (error) {
      notify.error("Aperçu impossible", cleanMessage(error));
    } finally {
      setPreviewing(false);
    }
  };

  const generate = async () => {
    if (startingRef.current || running) return;
    if (!text.trim()) {
      notify.warning("Rien à lire", "Le texte est vide.");
      return;
    }
    startingRef.current = true;
    setStarting(true);
    try {
      if (job && job.status !== "running" && job.status !== "cancelling") clearSpeechJob(job.id);
      await startSpeechJob<TtsResult>({
        toolId: tool.id,
        kind: "speech-synthesis",
        title: baseName,
        run: async (context) => {
          const audio = await synthesize(
            { text, voiceId, speed: Number(speed) },
            context,
          );
          const file = await toAudioFile(audio, format, baseName);
          return {
            file,
            durationMs: audio.durationMs,
            segments: audio.segments,
            voiceLabel,
          };
        },
      });
    } catch (error) {
      notify.error("Lancement impossible", cleanMessage(error));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const outcome: OperationOutcome | undefined = result
    ? {
        files: [result.file],
        summary: `Audio de ${formatDuration(result.durationMs)} — voix ${result.voiceLabel}, ${result.segments} segment${result.segments > 1 ? "s" : ""}.`,
      }
    : undefined;

  return (
    <div className="space-y-4">
      {header}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--ft-text-muted)]">{textLabel}</span>
          <span className="tabular-nums text-[11px] text-[var(--ft-text-faint)]">
            {counts.characters.toLocaleString("fr-FR")} caractères · {counts.words.toLocaleString("fr-FR")} mots
          </span>
        </div>
        <textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          disabled={running}
          rows={10}
          placeholder="Collez ou saisissez le texte à lire…"
          className="w-full rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-bg)] p-3 font-sans text-sm outline-none focus:border-[var(--ft-accent)]"
        />
        {readOnlyNote && <p className="text-[11px] text-[var(--ft-text-faint)]">{readOnlyNote}</p>}
      </div>

      <Fieldset columns={3}>
        <Field label="Voix">
          <Select
            value={voiceId}
            onChange={setVoiceId}
            disabled={running}
            options={installedVoices.map((voice) => ({ value: voice.id, label: voice.label }))}
          />
        </Field>
        <Field label="Vitesse">
          <Select
            value={speed}
            onChange={setSpeed}
            disabled={running}
            options={SPEEDS.map((entry) => ({ value: entry.value, label: entry.label }))}
          />
        </Field>
        <Field label="Format de sortie">
          <OptionGroup ariaLabel="Format" value={format} onChange={setFormat} options={FORMATS} />
        </Field>
      </Fieldset>

      <LocalProcessingNote />

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ft-border)] pt-4">
        <Button size="sm" onClick={() => void listen()} disabled={previewing || running || !text.trim()}>
          {previewing ? (
            <><Icon name="Loader" size={14} className="animate-spin" /> Aperçu…</>
          ) : (
            <><Icon name="Volume2" size={14} /> Écouter un aperçu</>
          )}
        </Button>
        {running && (
          <Button size="sm" variant="ghost" onClick={() => job && cancelSpeechJob(job.id)}>
            Annuler
          </Button>
        )}
        <Button
          size="md"
          variant="primary"
          onClick={() => void generate()}
          disabled={running || starting || !text.trim()}
        >
          {running ? (
            <><Icon name="Loader" size={15} className="animate-spin" /> {job?.step ?? "Synthèse…"}</>
          ) : (
            <><Icon name="Play" size={15} /> Générer l'audio</>
          )}
        </Button>
      </div>

      {running && (
        <div className="space-y-1">
          <div className="h-1 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]"
              style={{ width: `${Math.round((job?.ratio ?? 0) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-[var(--ft-text-faint)]">
            {job?.step ?? "Synthèse en cours"} — vous pouvez quitter cet outil, le traitement continue.
          </p>
        </div>
      )}

      {preview && (
        <AudioPreview bytes={preview} mimeType="audio/wav" label="Aperçu de la voix" />
      )}

      {job?.status === "error" && job.error && (
        // Une annulation demandée par l'utilisateur n'est pas une panne.
        job.error === SPEECH_CANCELLED ? (
          <p className="flex items-center gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm text-[var(--ft-text-muted)]">
            <Icon name="Info" size={15} /> {job.error}
          </p>
        ) : (
          <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
            <Icon name="CircleAlert" size={16} /> {job.error}
          </p>
        )
      )}

      {outcome && result && (
        <>
          <ResultPanel outcome={outcome} />
          <p className="text-[11px] text-[var(--ft-text-faint)]">
            {formatDuration(result.durationMs)} · {formatSize(result.file.bytes.length)} ·{" "}
            {result.voiceLabel} · {result.file.name.split(".").pop()?.toUpperCase()}
          </p>
          <AudioPreview
            bytes={result.file.bytes}
            mimeType={result.file.mimeType}
            label="Écouter le résultat"
          />
        </>
      )}
    </div>
  );
}
