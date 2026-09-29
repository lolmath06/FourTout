import { beforeEach, describe, expect, it } from "vitest";
import { JobCancelledError } from "@/core/jobs/types";
import { useJobStore } from "./store";
import {
  SPEECH_CANCELLED,
  cancelSpeechJob,
  clearSpeechJob,
  speechJob,
  speechJobResult,
  startSpeechJob,
} from "./speech";

/**
 * Un livre entier à lire ou une heure à transcrire ne doit pas mourir parce que
 * l'utilisateur est allé voir un autre outil. Ces tests portent sur ce point
 * précis : le job vit hors de React, garde son résultat, et s'arrête vraiment
 * quand on le lui demande.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useJobStore.setState({ jobs: {}, order: [] });
});

describe("jobs de parole", () => {
  it("publie la progression puis conserve le résultat hors du store", async () => {
    const id = await startSpeechJob<{ words: number }>({
      toolId: "text-to-speech",
      kind: "speech-synthesis",
      title: "lecture",
      run: async ({ report }) => {
        report({ ratio: 0.5, label: "Segment 1 sur 2" });
        return { words: 42 };
      },
    });

    await flush();

    const job = speechJob("text-to-speech");
    expect(job?.status).toBe("done");
    expect(job?.ratio).toBe(1);
    // Le résultat n'encombre pas le store : il vit à côté, indexé par id.
    expect(speechJobResult<{ words: number }>(id)).toEqual({ words: 42 });
    // Chercher « 42 » dans le JSON entier était un piège : un horodatage
    // contient tôt ou tard ces deux chiffres. On vérifie la seule chose qui
    // compte — le job ne porte aucun champ de résultat.
    expect(useJobStore.getState().jobs[id]).not.toHaveProperty("result");
    expect(useJobStore.getState().jobs[id]).not.toHaveProperty("words");
  });

  it("reste retrouvable après un démontage de l'interface", async () => {
    let release!: (value: string) => void;
    await startSpeechJob<string>({
      toolId: "audio-transcribe",
      kind: "speech-transcription",
      title: "reunion.mp3",
      run: () => new Promise<string>((resolve) => (release = resolve)),
    });

    // « Navigation » : plus aucun composant n'écoute, le job continue.
    expect(speechJob("audio-transcribe")?.status).toBe("running");
    release("transcription");
    await flush();
    expect(speechJob("audio-transcribe")?.status).toBe("done");
  });

  it("marque l'arrêt demandé comme une annulation, pas comme une panne", async () => {
    const id = await startSpeechJob<void>({
      toolId: "text-to-speech",
      kind: "speech-synthesis",
      title: "lecture",
      run: ({ signal }) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => reject(new JobCancelledError()));
        }),
    });

    cancelSpeechJob(id);
    expect(speechJob("text-to-speech")?.status).toBe("cancelling");
    await flush();

    expect(speechJob("text-to-speech")?.error).toBe(SPEECH_CANCELLED);
    // Aucun résultat partiel n'est présenté.
    expect(speechJobResult(id)).toBeUndefined();
  });

  it("remonte un échec du moteur avec son message", async () => {
    await startSpeechJob<void>({
      toolId: "text-to-speech",
      kind: "speech-synthesis",
      title: "lecture",
      run: async () => {
        throw new Error("Le moteur de synthèse vocale (Piper) n'est pas installé.");
      },
    });
    await flush();
    expect(speechJob("text-to-speech")?.error).toMatch(/Piper.*pas installé/);
  });

  it("refuse un second traitement tant que le premier tourne", async () => {
    await startSpeechJob<void>({
      toolId: "text-to-speech",
      kind: "speech-synthesis",
      title: "lecture",
      run: () => new Promise<void>(() => {}),
    });

    await expect(
      startSpeechJob<void>({
        toolId: "text-to-speech",
        kind: "speech-synthesis",
        title: "autre",
        run: async () => {},
      }),
    ).rejects.toThrow(/déjà en cours/);
  });

  it("remplace un job terminé au lancement suivant", async () => {
    const first = await startSpeechJob<string>({
      toolId: "text-to-speech",
      kind: "speech-synthesis",
      title: "un",
      run: async () => "un",
    });
    await flush();

    const second = await startSpeechJob<string>({
      toolId: "text-to-speech",
      kind: "speech-synthesis",
      title: "deux",
      run: async () => "deux",
    });
    await flush();

    expect(useJobStore.getState().order).toEqual([second]);
    expect(speechJobResult(first)).toBeUndefined();
    expect(speechJobResult(second)).toBe("deux");
  });

  it("oublie complètement un job effacé", async () => {
    const id = await startSpeechJob<string>({
      toolId: "text-to-speech",
      kind: "speech-synthesis",
      title: "lecture",
      run: async () => "fait",
    });
    await flush();

    clearSpeechJob(id);
    expect(speechJob("text-to-speech")).toBeUndefined();
    expect(speechJobResult(id)).toBeUndefined();
  });

  it("n'interfère pas entre deux outils différents", async () => {
    await startSpeechJob<string>({
      toolId: "pdf-to-audio",
      kind: "speech-synthesis",
      title: "doc.pdf",
      run: async () => "audio",
    });
    await startSpeechJob<string>({
      toolId: "audio-generate-srt",
      kind: "speech-transcription",
      title: "video.mp4",
      run: async () => "srt",
    });
    await flush();

    expect(speechJob("pdf-to-audio")?.title).toBe("doc.pdf");
    expect(speechJob("audio-generate-srt")?.title).toBe("video.mp4");
  });
});
