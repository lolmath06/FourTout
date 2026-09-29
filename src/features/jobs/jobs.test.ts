import { beforeEach, describe, expect, it } from "vitest";
import {
  activeJobs,
  isJobActive,
  latestJobForTool,
  listJobs,
  useJobStore,
  type Job,
} from "./store";

function baseJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "j1",
    toolId: "pdf-recover-password",
    kind: "pdf-recover-password",
    title: "doc.pdf",
    status: "running",
    startedAt: 1,
    cancellable: true,
    total: 100,
    ...overrides,
  };
}

describe("gestionnaire global de jobs", () => {
  beforeEach(() => useJobStore.setState({ jobs: {}, order: [] }));

  it("crée un job et le retrouve par outil", () => {
    useJobStore.getState().create(baseJob());
    const job = latestJobForTool(useJobStore.getState(), "pdf-recover-password");
    expect(job?.id).toBe("j1");
    expect(job?.status).toBe("running");
  });

  it("ne recrée pas un job déjà présent", () => {
    useJobStore.getState().create(baseJob());
    useJobStore.getState().create(baseJob({ title: "autre.pdf" }));
    expect(listJobs(useJobStore.getState())).toHaveLength(1);
    expect(useJobStore.getState().jobs.j1.title).toBe("doc.pdf");
  });

  it("met à jour la progression puis le résultat", () => {
    useJobStore.getState().create(baseJob());
    useJobStore.getState().update("j1", {
      progress: { tested: 50, total: 100, rate: 25, elapsedMs: 2000 },
    });
    expect(useJobStore.getState().jobs.j1.progress?.tested).toBe(50);

    useJobStore.getState().update("j1", {
      status: "done",
      result: { status: "found", password: "secret", tested: 60, elapsedMs: 2400 },
    });
    const job = useJobStore.getState().jobs.j1;
    expect(job.status).toBe("done");
    expect(job.result?.password).toBe("secret");
  });

  it("distingue les jobs actifs des jobs terminés", () => {
    useJobStore.getState().create(baseJob({ id: "run", status: "running" }));
    useJobStore.getState().create(baseJob({ id: "cancelling", status: "cancelling" }));
    useJobStore.getState().create(baseJob({ id: "done", status: "done" }));
    const active = activeJobs(useJobStore.getState()).map((j) => j.id).sort();
    expect(active).toEqual(["cancelling", "run"]);
    expect(isJobActive(useJobStore.getState().jobs.done)).toBe(false);
  });

  it("retourne le job le plus récent pour un outil", () => {
    useJobStore.getState().create(baseJob({ id: "old", startedAt: 1 }));
    useJobStore.getState().create(baseJob({ id: "new", startedAt: 2 }));
    expect(latestJobForTool(useJobStore.getState(), "pdf-recover-password")?.id).toBe("new");
  });

  it("oublie un job retiré", () => {
    useJobStore.getState().create(baseJob());
    useJobStore.getState().remove("j1");
    expect(listJobs(useJobStore.getState())).toHaveLength(0);
    expect(latestJobForTool(useJobStore.getState(), "pdf-recover-password")).toBeUndefined();
  });

  it("ignore la mise à jour d'un job inconnu", () => {
    useJobStore.getState().update("fantôme", { status: "done" });
    expect(listJobs(useJobStore.getState())).toHaveLength(0);
  });
});
