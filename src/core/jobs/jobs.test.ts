import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useJob } from "./useJob";
import { JobCancelledError } from "./types";

describe("traitements longs", () => {
  it("démarre au repos", () => {
    const { result } = renderHook(() => useJob<string>());
    expect(result.current.status).toBe("idle");
    expect(result.current.isRunning).toBe(false);
  });

  it("publie la progression puis le résultat", async () => {
    const { result } = renderHook(() => useJob<string>());

    await act(async () => {
      await result.current.run(async ({ report }) => {
        report({ ratio: 0.5, label: "Page 1 sur 2" });
        return "terminé";
      });
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.result).toBe("terminé");
    expect(result.current.progress).toEqual({ ratio: 0.5, label: "Page 1 sur 2" });
  });

  it("rapporte une erreur sans la laisser remonter", async () => {
    const { result } = renderHook(() => useJob<string>());

    await act(async () => {
      await result.current.run(async () => {
        throw new Error("ffmpeg indisponible");
      });
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("ffmpeg indisponible");
  });

  it("gère l'annulation", async () => {
    const { result } = renderHook(() => useJob<string>());

    await act(async () => {
      await result.current.run(async ({ throwIfCancelled }) => {
        result.current.cancel();
        throwIfCancelled();
        return "jamais atteint";
      });
    });

    await waitFor(() => expect(result.current.status).toBe("cancelled"));
    expect(result.current.result).toBeUndefined();
  });

  it("expose un signal d'annulation aux traitements natifs", async () => {
    const { result } = renderHook(() => useJob<boolean>());
    let seenSignal: AbortSignal | undefined;

    await act(async () => {
      await result.current.run(async ({ signal }) => {
        seenSignal = signal;
        return true;
      });
    });

    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("permet de repartir de zéro", async () => {
    const { result } = renderHook(() => useJob<string>());
    await act(async () => {
      await result.current.run(async () => "ok");
    });
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
  });

  it("expose une erreur d'annulation dédiée", () => {
    expect(new JobCancelledError().name).toBe("JobCancelledError");
  });
});
