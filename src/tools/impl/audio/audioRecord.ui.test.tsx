import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

/**
 * Enregistrement au micro.
 *
 * WebKitGTK ne demande jamais l'autorisation de lui-même : FourTout la demande
 * explicitement (dialogue natif) avant d'ouvrir le flux. Ces tests couvrent
 * l'enchaînement complet côté interface — accord, refus, nouvelle tentative,
 * échec matériel — et surtout la libération du micro. Le dialogue natif Fedora
 * lui-même n'est pas reproductible ici : il est vérifié manuellement
 * (voir docs/AUDIO.md).
 */

const invokeMock = vi.fn();

vi.mock("@/core/platform", () => ({
  isTauri: () => true,
  detectPlatform: () => "linux",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { toolRegistry } from "@/core/tools/registry";
import { AudioRecordTool } from "./AudioRecordTool";

class FakeTrack {
  kind = "audio";
  readyState: "live" | "ended" = "live";
  stop() {
    this.readyState = "ended";
  }
}

class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(readonly stream: unknown) {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["son"]) });
    this.onstop?.();
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  closed = false;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createAnalyser() {
    return {
      fftSize: 0,
      frequencyBinCount: 8,
      getByteTimeDomainData: () => {},
    };
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

const getUserMedia = vi.fn();
const enumerateDevices = vi.fn();
const tool = toolRegistry.get("audio-record")!;

/** Réponses par défaut du pont natif : autorisation jamais demandée, accordée. */
function bridge({ state = "prompt", granted = true }: { state?: string; granted?: boolean } = {}) {
  invokeMock.mockImplementation((command: string) => {
    if (command === "mic_permission_state") return Promise.resolve(state);
    if (command === "mic_request_permission") return Promise.resolve(granted);
    return Promise.resolve(undefined);
  });
}

/** Clique sur un bouton et laisse les promesses du flux se résoudre. */
async function click(name: RegExp) {
  await act(async () => {
    screen.getByRole("button", { name }).click();
  });
}

beforeEach(() => {
  FakeRecorder.instances = [];
  FakeAudioContext.instances = [];
  invokeMock.mockReset();
  getUserMedia.mockReset();
  enumerateDevices.mockReset();
  getUserMedia.mockImplementation(() => Promise.resolve(new FakeStream()));
  enumerateDevices.mockResolvedValue([]);

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices },
  });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  // La boucle de mesure n'a pas à tourner pendant les tests.
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: () => "blob:enregistrement",
    revokeObjectURL: () => {},
  }));
  bridge();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("demande d'autorisation du microphone", () => {
  it("ne demande rien tant que l'utilisateur n'a pas cliqué sur Démarrer", async () => {
    // Le montage liste les entrées audio, ce qui n'ouvre aucun flux.
    await act(async () => {
      render(<AudioRecordTool tool={tool} />);
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("demande l'autorisation puis démarre l'enregistrement si elle est accordée", async () => {
    render(<AudioRecordTool tool={tool} />);
    await click(/Démarrer/);

    expect(invokeMock).toHaveBeenCalledWith("mic_permission_state");
    expect(invokeMock).toHaveBeenCalledWith("mic_request_permission");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Arrêter/ })).toBeInTheDocument();
  });

  it("ne redemande pas l'autorisation lorsqu'elle est déjà accordée", async () => {
    bridge({ state: "granted" });
    render(<AudioRecordTool tool={tool} />);
    await click(/Démarrer/);

    expect(invokeMock).not.toHaveBeenCalledWith("mic_request_permission");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("explique le refus et propose de redemander, sans ouvrir de flux", async () => {
    bridge({ granted: false });
    render(<AudioRecordTool tool={tool} />);
    await click(/Démarrer/);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByText("L'accès au microphone a été refusé.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Autoriser le microphone/ })).toBeInTheDocument();
  });

  it("relance la demande depuis le bouton de secours", async () => {
    bridge({ granted: false });
    render(<AudioRecordTool tool={tool} />);
    await click(/Démarrer/);

    bridge({ granted: true });
    await click(/Autoriser le microphone/);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Arrêter/ })).toBeInTheDocument();
  });

  it("distingue un refus tardif de la WebView d'une absence de micro", async () => {
    getUserMedia.mockRejectedValue(new DOMException("no device", "NotFoundError"));
    render(<AudioRecordTool tool={tool} />);
    await click(/Démarrer/);

    expect(screen.getByText("Aucun microphone détecté.")).toBeInTheDocument();

    cleanup();
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    render(<AudioRecordTool tool={tool} />);
    await click(/Démarrer/);

    expect(screen.getByText("L'accès au microphone a été refusé.")).toBeInTheDocument();
  });

  it("signale une erreur inattendue de getUserMedia", async () => {
    getUserMedia.mockRejectedValue(new Error("boum"));
    render(<AudioRecordTool tool={tool} />);
    await click(/Démarrer/);

    expect(screen.getByText("Impossible d'accéder au microphone.")).toBeInTheDocument();
  });
});

describe("libération du microphone", () => {
  it("arrête toutes les pistes et ferme le contexte audio à l'arrêt", async () => {
    render(<AudioRecordTool tool={tool} />);
    await click(/Démarrer/);

    const stream = (await getUserMedia.mock.results[0].value) as FakeStream;
    expect(stream.getTracks().every((track) => track.readyState === "live")).toBe(true);

    await click(/Arrêter/);

    expect(stream.getTracks().every((track) => track.readyState === "ended")).toBe(true);
    expect(FakeAudioContext.instances.every((context) => context.closed)).toBe(true);
    expect(FakeRecorder.instances[0].state).toBe("inactive");
  });

  it("arrête toutes les pistes au démontage, enregistrement en cours", async () => {
    const view = render(<AudioRecordTool tool={tool} />);
    await click(/Démarrer/);
    const stream = (await getUserMedia.mock.results[0].value) as FakeStream;

    act(() => view.unmount());

    expect(stream.getTracks().every((track) => track.readyState === "ended")).toBe(true);
    expect(FakeAudioContext.instances.every((context) => context.closed)).toBe(true);
  });

  it("n'ouvre qu'une seule capture même sur double-clic", async () => {
    render(<AudioRecordTool tool={tool} />);
    await act(async () => {
      const button = screen.getByRole("button", { name: /Démarrer/ });
      button.click();
      button.click();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances).toHaveLength(1);
  });

  it("réutilise un seul flux à la fois lors d'un réenregistrement", async () => {
    render(<AudioRecordTool tool={tool} />);
    await click(/Démarrer/);
    const first = (await getUserMedia.mock.results[0].value) as FakeStream;
    await click(/Arrêter/);
    await click(/Réenregistrer/);

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(first.getTracks().every((track) => track.readyState === "ended")).toBe(true);
  });
});
