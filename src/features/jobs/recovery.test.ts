import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryHandlers, RecoverySession } from "@/core/recovery/client";
import { useJobStore } from "./store";
import {
  __setRecoveryStarter,
  activeRecoveryJob,
  cancelRecoveryJob,
  clearRecoveryJob,
  recoverySource,
  startRecoveryJob,
} from "./recovery";

/**
 * Le contrôleur est testé avec un lanceur injecté qui expose les rappels
 * `onProgress` / `onDone` : on pilote ainsi tout le cycle de vie sans moteur
 * natif, exactement comme les événements Tauri le feraient.
 */
function fakeStarter() {
  const captured: { handlers?: RecoveryHandlers } = {};
  const cancel = vi.fn(async () => {});
  const dispose = vi.fn();
  const starter = vi.fn(async (_params, _tier, handlers: RecoveryHandlers) => {
    captured.handlers = handlers;
    const session: RecoverySession = { total: 14_000_000, cancel, dispose };
    return session;
  });
  return { starter, captured, cancel, dispose };
}

const PARAMS = { revision: 5, keyLength: 32, o: "00", u: "00", p: 0, id0: "00", encryptMetadata: true };
const SOURCE = { name: "secret.pdf", bytes: new Uint8Array([1, 2, 3]) };

describe("contrôleur de récupération (jobs persistants)", () => {
  beforeEach(() => useJobStore.setState({ jobs: {}, order: [] }));

  it("crée un job actif au démarrage et le conserve après « navigation »", async () => {
    const fake = fakeStarter();
    const restore = __setRecoveryStarter(fake.starter);
    try {
      const id = await startRecoveryJob({ source: SOURCE, params: PARAMS, tier: "full" });
      // Le job survit à tout démontage de composant : il vit dans le store global.
      const job = activeRecoveryJob();
      expect(job?.id).toBe(id);
      expect(job?.status).toBe("running");
      expect(job?.total).toBe(14_000_000);
      expect(recoverySource(id)?.name).toBe("secret.pdf");
    } finally {
      restore();
    }
  });

  it("relaie la progression puis le résultat trouvé", async () => {
    const fake = fakeStarter();
    const restore = __setRecoveryStarter(fake.starter);
    try {
      const id = await startRecoveryJob({ source: SOURCE, params: PARAMS, tier: "full" });
      fake.captured.handlers!.onProgress({ tested: 360_000, total: 14_000_000, rate: 20_000, elapsedMs: 18_000 });
      expect(useJobStore.getState().jobs[id].progress?.tested).toBe(360_000);

      fake.captured.handlers!.onDone({ status: "found", password: "rett2024", tested: 360_022, elapsedMs: 18_100 });
      const job = useJobStore.getState().jobs[id];
      expect(job.status).toBe("done");
      expect(job.result?.password).toBe("rett2024");
      expect(job.cancellable).toBe(false);
      expect(fake.dispose).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("passe à « arrêt en cours » puis « annulé » sans résultat trouvé tardif", async () => {
    const fake = fakeStarter();
    const restore = __setRecoveryStarter(fake.starter);
    try {
      const id = await startRecoveryJob({ source: SOURCE, params: PARAMS, tier: "full" });
      await cancelRecoveryJob(id);
      expect(useJobStore.getState().jobs[id].status).toBe("cancelling");
      expect(fake.cancel).toHaveBeenCalled();

      fake.captured.handlers!.onDone({ status: "cancelled", tested: 400_000, elapsedMs: 20_000 });
      const job = useJobStore.getState().jobs[id];
      expect(job.status).toBe("done");
      expect(job.result?.status).toBe("cancelled");
      expect(job.result?.password).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("gère l'annulation immédiate (course démarrage → annulation)", async () => {
    const fake = fakeStarter();
    const restore = __setRecoveryStarter(fake.starter);
    try {
      const id = await startRecoveryJob({ source: SOURCE, params: PARAMS, tier: "full" });
      await cancelRecoveryJob(id);
      // Même annulé aussitôt, le job reste connu et marqué « arrêt en cours ».
      expect(activeRecoveryJob()?.status).toBe("cancelling");
      fake.captured.handlers!.onDone({ status: "cancelled", tested: 0, elapsedMs: 5 });
      expect(useJobStore.getState().jobs[id].result?.status).toBe("cancelled");
    } finally {
      restore();
    }
  });

  it("refuse deux récupérations simultanées mais autorise une relance après la fin", async () => {
    const fake = fakeStarter();
    const restore = __setRecoveryStarter(fake.starter);
    try {
      const first = await startRecoveryJob({ source: SOURCE, params: PARAMS, tier: "full" });
      await expect(startRecoveryJob({ source: SOURCE, params: PARAMS, tier: "quick" })).rejects.toThrow(
        /déjà en cours/i,
      );

      fake.captured.handlers!.onDone({ status: "exhausted", tested: 14_000_000, elapsedMs: 720_000 });
      // Une relance après la fin remplace le job terminé (un seul par outil).
      const second = await startRecoveryJob({ source: SOURCE, params: PARAMS, tier: "quick" });
      expect(second).not.toBe(first);
      expect(useJobStore.getState().jobs[first]).toBeUndefined();
      expect(activeRecoveryJob()?.id).toBe(second);
    } finally {
      restore();
    }
  });

  it("marque le job en erreur si le lancement échoue", async () => {
    const failing = vi.fn(async () => {
      throw new Error("moteur natif indisponible");
    });
    const restore = __setRecoveryStarter(failing as never);
    try {
      await expect(startRecoveryJob({ source: SOURCE, params: PARAMS, tier: "full" })).rejects.toThrow(
        /moteur natif/i,
      );
      const job = activeRecoveryJob();
      expect(job?.status).toBe("error");
      expect(job?.error).toMatch(/moteur natif/i);
    } finally {
      restore();
    }
  });

  it("laisse oublier un job terminé", async () => {
    const fake = fakeStarter();
    const restore = __setRecoveryStarter(fake.starter);
    try {
      const id = await startRecoveryJob({ source: SOURCE, params: PARAMS, tier: "full" });
      fake.captured.handlers!.onDone({ status: "found", password: "x", tested: 10, elapsedMs: 5 });
      clearRecoveryJob(id);
      expect(activeRecoveryJob()).toBeUndefined();
      expect(recoverySource(id)).toBeUndefined();
    } finally {
      restore();
    }
  });
});
