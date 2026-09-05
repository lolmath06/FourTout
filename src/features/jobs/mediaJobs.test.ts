import { beforeEach, describe, expect, it } from "vitest";
import { JobCancelledError } from "@/core/jobs/types";
import { useJobStore } from "./store";
import {
  MEDIA_CANCELLED_JOB,
  cancelMediaJob,
  clearMediaJob,
  mediaJob,
  mediaJobResult,
  startMediaJob,
} from "./media";
import { speechJob, startSpeechJob } from "./speech";

/**
 * Un réencodage se compte en minutes. Ces tests portent sur le seul point qui
 * compte pour l'utilisateur : le traitement ne meurt pas parce qu'il a changé
 * de page, il s'arrête vraiment quand on le lui demande, et aucun fichier
 * partiel n'est présenté comme un résultat.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useJobStore.setState({ jobs: {}, order: [] });
});

describe("jobs vidéo", () => {
  it("survit au démontage de l'interface et conserve les fichiers produits", async () => {
    let release!: () => void;
    await startMediaJob({
      toolId: "video-compress",
      title: "vacances.mp4",
      run: () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              files: [{ name: "vacances-compressee.mp4", bytes: new Uint8Array([1, 2]), mimeType: "video/mp4" }],
              summary: "12 Mo → 4 Mo",
            });
        }),
    });

    // « Navigation » : plus aucun composant n'écoute, le job continue.
    expect(mediaJob("video-compress")?.status).toBe("running");
    release();
    await flush();

    const job = mediaJob("video-compress");
    expect(job?.status).toBe("done");
    expect(mediaJobResult(job!.id)?.summary).toBe("12 Mo → 4 Mo");
    // Les octets n'encombrent pas le store : ils vivent à côté.
    expect(JSON.stringify(useJobStore.getState().jobs[job!.id])).not.toContain("bytes");
  });

  it("marque l'arrêt demandé comme une annulation, sans résultat partiel", async () => {
    const id = await startMediaJob({
      toolId: "video-convert",
      title: "clip.mp4",
      run: ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new JobCancelledError()));
        }),
    });

    cancelMediaJob(id);
    expect(mediaJob("video-convert")?.status).toBe("cancelling");
    await flush();

    expect(mediaJob("video-convert")?.error).toBe(MEDIA_CANCELLED_JOB);
    expect(mediaJobResult(id)).toBeUndefined();
  });

  it("publie une progression réelle pendant le traitement", async () => {
    let publish!: (ratio: number, label: string) => void;
    await startMediaJob({
      toolId: "video-resolution",
      title: "clip.mp4",
      run: ({ report }) =>
        new Promise((resolve) => {
          publish = (ratio, label) => {
            report({ ratio, label });
            resolve({ files: [], summary: "fait" });
          };
        }),
    });

    publish(0.42, "Redimensionnement…");
    expect(mediaJob("video-resolution")?.ratio).toBe(0.42);
    expect(mediaJob("video-resolution")?.step).toBe("Redimensionnement…");
    await flush();
    expect(mediaJob("video-resolution")?.ratio).toBe(1);
  });

  it("refuse un second traitement tant que le premier tourne", async () => {
    await startMediaJob({
      toolId: "video-crop",
      title: "clip.mp4",
      run: () => new Promise(() => {}),
    });

    await expect(
      startMediaJob({ toolId: "video-crop", title: "autre.mp4", run: async () => ({ files: [] }) }),
    ).rejects.toThrow(/déjà en cours/);
  });

  it("remonte l'échec du moteur avec son message", async () => {
    await startMediaJob({
      toolId: "video-merge",
      title: "clip.mp4",
      run: async () => {
        throw new Error("Unknown encoder 'libx265'");
      },
    });
    await flush();
    expect(mediaJob("video-merge")?.error).toMatch(/libx265/);
  });

  it("oublie complètement un job effacé", async () => {
    const id = await startMediaJob({
      toolId: "video-rotate",
      title: "clip.mp4",
      run: async () => ({ files: [], summary: "fait" }),
    });
    await flush();

    clearMediaJob(id);
    expect(mediaJob("video-rotate")).toBeUndefined();
    expect(mediaJobResult(id)).toBeUndefined();
  });

  it("cohabite avec les jobs de parole sans interférence", async () => {
    await startMediaJob({
      toolId: "video-generate-subtitles:burn",
      title: "clip.mp4",
      run: async () => ({ files: [], summary: "incrusté" }),
    });
    await startSpeechJob<string>({
      toolId: "video-generate-subtitles",
      kind: "speech-transcription",
      title: "clip.mp4",
      run: async () => "srt",
    });
    await flush();

    // Deux jobs distincts pour le même outil : l'incrustation ne chasse pas la
    // transcription, et réciproquement.
    expect(mediaJob("video-generate-subtitles:burn")?.kind).toBe("video-processing");
    expect(speechJob("video-generate-subtitles")?.kind).toBe("speech-transcription");
  });
});
