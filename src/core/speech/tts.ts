import { isTauri } from "@/core/platform";
import { cleanup, runMedia } from "@/core/media/client";
import { convertAudio } from "@/core/media/operations/audio";
import { JobCancelledError, type JobContext } from "@/core/jobs/types";
import { segmentText, previewText } from "./segment";
import type { SelectedFile } from "@/core/files";
import type { OutputFile } from "@/core/pdf/types";

/**
 * Synthèse vocale locale (Piper).
 *
 * Le texte est découpé en segments, synthétisé segment par segment, puis
 * recollé nativement (même format PCM d'un bout à l'autre). C'est ce qui rend
 * possible une progression honnête, une annulation immédiate et la lecture d'un
 * document entier sans saturer la mémoire. Rien ne quitte l'appareil.
 */

/** Moteur requis pour toute synthèse. */
export const TTS_ENGINE = "engine-piper";

/** Voix livrées par le catalogue, dans l'ordre d'affichage. */
export const TTS_VOICES = [
  { id: "voice-fr-siwis", language: "fr", label: "Français — Siwis" },
  { id: "voice-en-lessac", language: "en", label: "Anglais — Lessac" },
] as const;

export type VoiceId = (typeof TTS_VOICES)[number]["id"];

/** Voix par défaut d'une langue. */
export function defaultVoice(language: string): VoiceId {
  return language === "en" ? "voice-en-lessac" : "voice-fr-siwis";
}

export interface SynthesisResult {
  /** WAV assemblé. */
  bytes: Uint8Array;
  durationMs: number;
  segments: number;
  voiceId: VoiceId;
}

export interface SynthesizeOptions {
  text: string;
  voiceId: VoiceId;
  /** 1 = vitesse naturelle ; 1.5 = plus rapide. */
  speed?: number;
  /** Longueur visée d'un segment, en caractères. */
  maxChars?: number;
}

async function speakSegment(
  jobId: string,
  voiceId: VoiceId,
  text: string,
  lengthScale: number,
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("tts_speak", {
    params: { jobId, voiceId, text, lengthScale, sentenceSilence: 0.25 },
  });
}

/**
 * Synthétise un texte complet. La progression est publiée segment par segment
 * et l'annulation tue réellement le moteur en cours.
 */
export async function synthesize(
  options: SynthesizeOptions,
  context?: Pick<JobContext, "report" | "signal">,
): Promise<SynthesisResult> {
  if (!isTauri()) throw new Error("La synthèse vocale nécessite l'application FourTout installée.");

  const segments = segmentText(options.text, { maxChars: options.maxChars });
  if (segments.length === 0) throw new Error("Le texte à lire est vide.");

  const { invoke } = await import("@tauri-apps/api/core");
  const jobId = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // Piper exprime la vitesse en durée de phonème : plus long = plus lent.
  const lengthScale = 1 / Math.min(Math.max(options.speed ?? 1, 0.5), 2);
  const parts: string[] = [];

  const onAbort = () => {
    void invoke("speech_cancel", { jobId });
  };
  context?.signal?.addEventListener("abort", onAbort);

  try {
    for (const [index, segment] of segments.entries()) {
      if (context?.signal?.aborted) throw new JobCancelledError();
      context?.report?.({
        ratio: index / segments.length,
        label: `Segment ${index + 1} sur ${segments.length}`,
      });

      try {
        parts.push(await speakSegment(jobId, options.voiceId, segment, lengthScale));
      } catch (error) {
        if (String(error) === "cancelled" || context?.signal?.aborted) throw new JobCancelledError();
        throw error instanceof Error ? error : new Error(String(error));
      }
    }

    if (context?.signal?.aborted) throw new JobCancelledError();
    context?.report?.({ ratio: 0.99, label: "Assemblage…" });

    const joined = await invoke<{ path: string; durationMs: number; bytes: number }>("tts_concat", {
      paths: parts,
    });
    try {
      const audio = await invoke<ArrayBuffer>("media_read", { path: joined.path });
      context?.report?.({ ratio: 1, label: "Terminé" });
      return {
        bytes: new Uint8Array(audio),
        durationMs: joined.durationMs,
        segments: segments.length,
        voiceId: options.voiceId,
      };
    } finally {
      await cleanup([joined.path]);
    }
  } finally {
    context?.signal?.removeEventListener("abort", onAbort);
    // Les segments intermédiaires ne survivent jamais à l'opération.
    await cleanup(parts);
  }
}

/** Synthétise un court extrait (première phrase) pour l'aperçu. */
export async function synthesizePreview(
  text: string,
  voiceId: VoiceId,
  speed = 1,
): Promise<SynthesisResult> {
  const preview = previewText(text);
  if (!preview) throw new Error("Le texte à lire est vide.");
  return synthesize({ text: preview, voiceId, speed });
}

export type AudioFormat = "wav" | "mp3";

/** Encapsule le WAV produit en fichier prêt à enregistrer, au format demandé. */
export async function toAudioFile(
  result: SynthesisResult,
  format: AudioFormat,
  baseName: string,
): Promise<OutputFile> {
  if (format === "wav") {
    return { name: `${baseName}.wav`, bytes: result.bytes, mimeType: "audio/wav" };
  }

  const file: SelectedFile = {
    id: "tts",
    name: `${baseName}.wav`,
    size: result.bytes.length,
    extension: "wav",
    mimeType: "audio/wav",
    kind: "audio",
    file: new File([result.bytes.slice().buffer as ArrayBuffer], `${baseName}.wav`),
  };
  const out = await runMedia({
    files: [file],
    operation: convertAudio("mp3"),
    outputName: `${baseName}.mp3`,
  });
  return out;
}

/** Durée lisible (`3 min 12 s`). */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} min ${String(seconds).padStart(2, "0")} s` : `${seconds} s`;
}
