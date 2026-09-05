import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cycle de vie complet d'une opération vidéo, sans FFmpeg : préparation des
 * entrées, écriture des fichiers de travail, exécution, relecture, puis
 * **nettoyage**. C'est le point où les régressions coûtent cher : un
 * temporaire oublié à chaque conversion remplit le disque, et un processus
 * survivant à l'annulation continue de tourner dans le dos de l'utilisateur.
 *
 * La justesse des commandes FFmpeg elles-mêmes est vérifiée ailleurs, contre le
 * vrai binaire (`video.test.ts`).
 */

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@/core/platform", () => ({ isTauri: () => true, detectPlatform: () => "linux" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])),
}));

import { JobCancelledError } from "@/core/jobs/types";
import { runMedia } from "./client";
import { concatVideoCopy, encodeVideo } from "./operations/video";
import type { SelectedFile } from "@/core/files";

const TEMP = "/tmp/fourtout-media";

function file(name: string, extension: string): SelectedFile {
  return {
    id: name,
    name,
    size: 1024,
    extension,
    mimeType: "video/mp4",
    kind: "video",
    // Fichier choisi par la boîte de dialogue native : ses octets sont relus
    // par le socle, sans handle navigateur.
    path: `/home/utilisateur/${name}`,
  };
}

/** Pont natif simulé : chaque commande répond comme le ferait Rust. */
function bridge(overrides: Record<string, (args: unknown) => unknown> = {}) {
  const staged: string[] = [];
  const cleaned: string[] = [];
  const cancelled: string[] = [];
  let execArgs: string[] = [];

  invokeMock.mockImplementation((command: string, args: unknown) => {
    if (overrides[command]) return overrides[command](args);
    switch (command) {
      case "media_stage": {
        const path = `${TEMP}/staged-${staged.length}.bin`;
        staged.push(path);
        return Promise.resolve(path);
      }
      case "media_temp":
        return Promise.resolve(`${TEMP}/out.mp4`);
      case "media_exec":
        execArgs = (args as { params: { args: string[] } }).params.args;
        return Promise.resolve(undefined);
      case "media_read":
        return Promise.resolve(new Uint8Array([0, 0, 0, 32]).buffer);
      case "media_cleanup":
        cleaned.push(...(args as { paths: string[] }).paths);
        return Promise.resolve(undefined);
      case "media_cancel":
        cancelled.push((args as { jobId: string }).jobId);
        return Promise.resolve(undefined);
      default:
        return Promise.resolve(undefined);
    }
  });

  listenMock.mockResolvedValue(() => {});
  return {
    staged,
    cleaned,
    cancelled,
    execArgs: () => execArgs,
  };
}

const simple = () =>
  encodeVideo({ container: "mp4", videoArgs: ["-c:v", "libx264"], audioArgs: ["-c:a", "aac"] });

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
});

describe("exécution d'une opération vidéo", () => {
  it("prépare l'entrée, exécute puis nettoie tous les temporaires", async () => {
    const native = bridge();
    const output = await runMedia({
      files: [file("clip.mp4", "mp4")],
      operation: simple(),
      outputName: "clip-converti.mp4",
    });

    expect(output.name).toBe("clip-converti.mp4");
    expect(output.mimeType).toBe("video/mp4");
    expect(native.execArgs()).toContain("-c:v");
    // Entrée préparée + sortie réservée : les deux sont supprimées.
    expect(native.cleaned).toContain(`${TEMP}/staged-0.bin`);
    expect(native.cleaned).toContain(`${TEMP}/out.mp4`);
  });

  it("ajoute les entrées générées par l'application après celles de l'utilisateur", async () => {
    const native = bridge();
    await runMedia({
      files: [file("clip.mp4", "mp4")],
      extraInputs: [{ bytes: new TextEncoder().encode("1\n00:00:00,000 --> 00:00:01,000\nTest\n"), ext: "srt" }],
      operation: {
        outputExt: "mp4",
        mimeType: "video/mp4",
        buildArgs: (inputs, out) => ["-i", inputs[0], "-i", inputs[1], out],
      },
      outputName: "clip-sous-titre.mp4",
    });

    expect(native.staged).toHaveLength(2);
    expect(native.execArgs()).toEqual(["-i", `${TEMP}/staged-0.bin`, "-i", `${TEMP}/staged-1.bin`, `${TEMP}/out.mp4`]);
    // Le sous-titre préparé est nettoyé comme le reste.
    expect(native.cleaned).toContain(`${TEMP}/staged-1.bin`);
  });

  it("écrit la liste de concaténation et la supprime ensuite", async () => {
    const native = bridge();
    await runMedia({
      files: [file("a.mp4", "mp4"), file("b.mp4", "mp4")],
      operation: concatVideoCopy("mp4"),
      outputName: "fusion.mp4",
    });

    // Deux vidéos + la liste préparée à partir de leurs chemins.
    expect(native.staged).toHaveLength(3);
    const args = native.execArgs();
    expect(args.slice(0, 4)).toEqual(["-f", "concat", "-safe", "0"]);
    expect(args[5]).toBe(`${TEMP}/staged-2.bin`);
    expect(native.cleaned).toEqual(expect.arrayContaining(native.staged));
  });

  it("nettoie aussi quand FFmpeg échoue, et remonte le message", async () => {
    const native = bridge({
      media_exec: () => Promise.reject(new Error("Unknown encoder 'libx265'")),
    });

    await expect(
      runMedia({ files: [file("clip.mp4", "mp4")], operation: simple(), outputName: "out.mp4" }),
    ).rejects.toThrow(/libx265/);
    expect(native.cleaned).toContain(`${TEMP}/staged-0.bin`);
  });

  it("tue le processus à l'annulation et ne renvoie aucun résultat partiel", async () => {
    const controller = new AbortController();
    const native = bridge({
      media_exec: () => {
        controller.abort();
        return Promise.reject(new Error("cancelled"));
      },
    });

    await expect(
      runMedia(
        { files: [file("clip.mp4", "mp4")], operation: simple(), outputName: "out.mp4" },
        { signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(JobCancelledError);

    // `media_cancel` a bien été demandé, et rien ne traîne.
    expect(native.cancelled).toHaveLength(1);
    expect(native.cleaned).toContain(`${TEMP}/staged-0.bin`);
  });

  it("relaie la progression du moteur sous l'étiquette de l'outil", async () => {
    bridge();
    let handler: ((event: { payload: { jobId: string; ratio: number } }) => void) | undefined;
    listenMock.mockImplementation((_name: string, callback: typeof handler) => {
      handler = callback;
      return Promise.resolve(() => {});
    });

    const reports: { ratio?: number; label?: string }[] = [];
    const promise = runMedia(
      {
        files: [file("clip.mp4", "mp4")],
        operation: simple(),
        outputName: "out.mp4",
        totalMs: 4000,
        label: "Compression…",
      },
      { report: (progress) => reports.push(progress) },
    );
    // L'écoute est branchée avant l'exécution : on peut publier immédiatement.
    await Promise.resolve();
    handler?.({ payload: { jobId: "autre-job", ratio: 0.9 } });
    await promise;

    // Le job d'un autre outil n'influence pas cette barre de progression.
    expect(reports.every((entry) => entry.label === "Compression…")).toBe(true);
  });
});
