import { useCallback, useEffect, useRef, useState } from "react";
import {
  JobCancelledError,
  type JobContext,
  type JobRunner,
  type JobState,
} from "./types";

const IDLE: JobState<never> = { status: "idle", progress: {} };

/**
 * Exécute un traitement long en exposant progression, succès, erreur et
 * annulation. C'est le point d'entrée que les futurs outils utiliseront :
 *
 * ```tsx
 * const job = useJob<Blob>();
 * await job.run(async ({ report, signal }) => compress(file, { report, signal }));
 * ```
 */
export function useJob<TResult>() {
  const [state, setState] = useState<JobState<TResult>>(IDLE as JobState<TResult>);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const run = useCallback(async (runner: JobRunner<TResult>): Promise<TResult | undefined> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState({ status: "running", progress: {}, startedAt: Date.now() });

    const context: JobContext = {
      report: (progress) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        setState((previous) =>
          previous.status === "running" ? { ...previous, progress } : previous,
        );
      },
      signal: controller.signal,
      throwIfCancelled: () => {
        if (controller.signal.aborted) throw new JobCancelledError();
      },
    };

    try {
      const result = await runner(context);
      if (!mountedRef.current) return result;
      if (controller.signal.aborted) {
        setState((p) => ({ ...p, status: "cancelled", endedAt: Date.now() }));
        return undefined;
      }
      setState((p) => ({ ...p, status: "success", result, endedAt: Date.now() }));
      return result;
    } catch (error) {
      if (!mountedRef.current) return undefined;
      const cancelled = error instanceof JobCancelledError || controller.signal.aborted;
      setState((p) => ({
        ...p,
        status: cancelled ? "cancelled" : "error",
        endedAt: Date.now(),
        error: cancelled
          ? undefined
          : {
              message: error instanceof Error ? error.message : "Erreur inattendue",
              cause: error,
            },
      }));
      return undefined;
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setState((p) =>
      p.status === "running" ? { ...p, status: "cancelled", endedAt: Date.now() } : p,
    );
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState(IDLE as JobState<TResult>);
  }, []);

  return { ...state, run, cancel, reset, isRunning: state.status === "running" };
}
