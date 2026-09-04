import { isTauri } from "@/core/platform";
import { cleanup, readBytes, stage, tempPath } from "@/core/media/client";
import { JobCancelledError, type JobContext } from "@/core/jobs/types";
import type { SelectedFile } from "@/core/files";
import type { TranscriptSegment } from "./subtitles";

/**
 * Transcription vocale locale (whisper.cpp).
 *
 * L'entrée peut être n'importe quel média lisible par FFmpeg : il est d'abord
 * normalisé en WAV 16 kHz mono, seul format attendu par le moteur, ce qui rend
 * la transcription d'une vidéo strictement identique à celle d'un MP3. Le
 * modèle tourne sur le processeur, hors ligne.
 */

export const STT_ENGINE = "engine-whisper";

/** Modèles proposés, du plus rapide au plus précis. */
export const STT_MODELS = [
  { id: "stt-base", label: "Rapide", detail: "Bon compromis, suffisant pour un audio net." },
  { id: "stt-small", label: "Précis", detail: "Nettement meilleur en français, environ 3× plus lent." },
] as const;

export type SttModelId = (typeof STT_MODELS)[number]["id"];

/** Langues proposées ; `auto` laisse whisper.cpp détecter. */
export const STT_LANGUAGES = [
  { value: "auto", label: "Détection automatique" },
  { value: "fr", label: "Français" },
  { value: "en", label: "Anglais" },
] as const;

export interface TranscriptionResult {
  segments: TranscriptSegment[];
  /** Langue retenue par le moteur. */
  language: string;
  modelId: SttModelId;
  /** Durée du média transcrit, en millisecondes. */
  durationMs: number;
}

interface WhisperJson {
  result?: { language?: string };
  transcription?: {
    offsets?: { from?: number; to?: number };
    text?: string;
  }[];
}

/** Convertit la sortie de whisper.cpp en passages horodatés. */
export function parseWhisperJson(raw: string): { segments: TranscriptSegment[]; language: string } {
  let parsed: WhisperJson;
  try {
    parsed = JSON.parse(raw) as WhisperJson;
  } catch {
    throw new Error("La transcription n'a pas pu être lue.");
  }

  const segments = (parsed.transcription ?? [])
    .map((entry) => ({
      start: Math.max(0, Math.round(entry.offsets?.from ?? 0)),
      end: Math.max(0, Math.round(entry.offsets?.to ?? 0)),
      text: (entry.text ?? "").trim(),
    }))
    .filter((segment) => segment.text.length > 0);

  return { segments, language: parsed.result?.language ?? "" };
}

/** Prépare le média : normalisation en WAV 16 kHz mono via le socle FFmpeg. */
async function toWav16k(file: SelectedFile, jobId: string): Promise<{ wav: string; staged: string }> {
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await readBytes(file);
  const staged = await stage(bytes, file.extension || "bin");
  const wav = await tempPath("wav");
  await invoke("media_exec", {
    params: {
      jobId: `${jobId}-prepare`,
      args: ["-i", staged, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav],
      totalMs: 0,
    },
  });
  return { wav, staged };
}

export interface TranscribeOptions {
  file: SelectedFile;
  modelId: SttModelId;
  /** `auto`, `fr` ou `en`. */
  language: string;
}

/**
 * Transcrit un fichier audio ou vidéo. La progression du moteur est relayée
 * telle quelle ; l'annulation tue réellement le processus.
 */
export async function transcribe(
  options: TranscribeOptions,
  context?: Pick<JobContext, "report" | "signal">,
): Promise<TranscriptionResult> {
  if (!isTauri()) throw new Error("La transcription nécessite l'application FourTout installée.");

  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const jobId = `stt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const temporary: string[] = [];

  const unlisten = await listen<{ jobId: string; ratio: number }>("speech://progress", (event) => {
    if (event.payload.jobId === jobId) {
      // La préparation occupe les premiers 10 % de la barre.
      context?.report?.({
        ratio: 0.1 + event.payload.ratio * 0.9,
        label: "Transcription…",
      });
    }
  });

  const onAbort = () => {
    void invoke("speech_cancel", { jobId });
    void invoke("media_cancel", { jobId: `${jobId}-prepare` });
  };
  context?.signal?.addEventListener("abort", onAbort);

  try {
    context?.report?.({ ratio: 0.02, label: "Préparation de l'audio…" });
    const { wav, staged } = await toWav16k(options.file, jobId);
    temporary.push(wav, staged);
    if (context?.signal?.aborted) throw new JobCancelledError();

    context?.report?.({ ratio: 0.1, label: "Transcription…" });
    let raw: string;
    try {
      raw = await invoke<string>("stt_transcribe", {
        params: {
          jobId,
          modelId: options.modelId,
          wavPath: wav,
          language: options.language,
        },
      });
    } catch (error) {
      if (String(error) === "cancelled" || context?.signal?.aborted) throw new JobCancelledError();
      throw error instanceof Error ? error : new Error(String(error));
    }

    const { segments, language } = parseWhisperJson(raw);
    if (segments.length === 0) {
      throw new Error("Aucune parole n'a été détectée dans ce fichier.");
    }

    context?.report?.({ ratio: 1, label: "Terminé" });
    return {
      segments,
      language: language || options.language,
      modelId: options.modelId,
      durationMs: segments[segments.length - 1]?.end ?? 0,
    };
  } finally {
    unlisten();
    context?.signal?.removeEventListener("abort", onAbort);
    await cleanup(temporary);
  }
}
