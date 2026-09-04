import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, Select } from "@/components/pdf/Field";
import { saveFile } from "@/core/output/save";
import { isMediaAvailable, runMedia } from "@/core/media/client";
import { convertAudio } from "@/core/media/operations/audio";
import { MicrophoneError, openMicrophone, releaseStream, type MicFailure } from "@/core/media/microphone";
import { notify } from "@/features/notifications/store";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

type State = "idle" | "recording" | "recorded";

/** Message affiché et possibilité de relancer la demande, selon l'échec. */
const FAILURES: Record<MicFailure, { message: string; hint?: string; retry: boolean }> = {
  unsupported: {
    message: "L'enregistrement audio n'est pas disponible dans cet environnement.",
    retry: false,
  },
  denied: {
    message: "L'accès au microphone a été refusé.",
    hint: "Cliquez sur « Autoriser le microphone » pour redemander l'accès. Si le refus vient du système, vérifiez le périphérique d'entrée dans les réglages de son de votre session.",
    retry: true,
  },
  "not-found": {
    message: "Aucun microphone détecté.",
    hint: "Branchez un micro, puis réessayez.",
    retry: true,
  },
  failed: {
    message: "Impossible d'accéder au microphone.",
    hint: "Réessayez ; si le problème persiste, vérifiez qu'aucune autre application ne monopolise le micro.",
    retry: true,
  },
};

export function AudioRecordTool(_props: ToolComponentProps) {
  const [state, setState] = useState<State>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<MicFailure | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  // Verrou synchrone : un double-clic ne doit pas ouvrir deux flux, et l'état
  // React n'est pas encore à jour au moment du second clic.
  const startingRef = useRef(false);

  /**
   * Rend le micro au système : pistes arrêtées, mesure de niveau coupée,
   * contexte audio fermé. Appelé à l'arrêt, en cas d'échec et au démontage —
   * aucune capture ne doit survivre à l'outil.
   */
  const release = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      // Démontage en cours d'enregistrement : on ne veut plus de résultat.
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // Déjà arrêté par le navigateur : rien à faire.
      }
    }
    recorderRef.current = null;

    releaseStream(streamRef.current);
    streamRef.current = null;

    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
  }, []);

  /** Liste les entrées audio. N'ouvre aucun flux : ne demande donc rien. */
  const refreshDevices = useCallback(() => {
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((list) => setDevices(list.filter((device) => device.kind === "audioinput")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshDevices();
    return release;
  }, [refreshDevices, release]);

  useEffect(() => {
    if (!blob) {
      setBlobUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const meter = (stream: MediaStream) => {
    const context = new AudioContext();
    contextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
      setLevel(Math.min(1, peak / 128));
      setElapsed(Date.now() - startRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const start = async () => {
    // Une seule capture à la fois, même si l'utilisateur insiste.
    if (startingRef.current || recorderRef.current) return;
    startingRef.current = true;
    setFailure(undefined);
    setBlob(null);
    setElapsed(0);
    setLevel(0);
    setStarting(true);
    try {
      release();
      const stream = await openMicrophone(deviceId || undefined);
      streamRef.current = stream;
      // Les noms des micros ne sont lisibles qu'une fois l'accès accordé.
      refreshDevices();

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => event.data.size > 0 && chunksRef.current.push(event.data);
      recorder.onstop = () => {
        setBlob(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
        setState("recorded");
        release();
      };
      recorder.start();
      recorderRef.current = recorder;
      startRef.current = Date.now();
      setState("recording");
      meter(stream);
    } catch (error) {
      release();
      setState("idle");
      setFailure(error instanceof MicrophoneError ? error.reason : "failed");
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else release();
  };

  const save = async (asWav: boolean) => {
    if (!blob) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    setBusy(true);
    try {
      if (asWav && (await isMediaAvailable())) {
        const file: SelectedFile = { id: "rec", name: "enregistrement.webm", size: bytes.length, extension: "webm", mimeType: blob.type, kind: "audio", file: new File([blob], "enregistrement.webm") };
        const out = await runMedia({ files: [file], operation: convertAudio("wav"), outputName: "enregistrement.wav" });
        const res = await saveFile({ name: out.name, bytes: out.bytes, mimeType: out.mimeType });
        if (res.saved) notify.success("Enregistrement sauvegardé", res.path);
      } else {
        const res = await saveFile({ name: "enregistrement.webm", bytes, mimeType: blob.type });
        if (res.saved) notify.success("Enregistrement sauvegardé", res.path);
      }
    } finally {
      setBusy(false);
    }
  };

  const seconds = Math.floor(elapsed / 1000);
  const problem = failure ? FAILURES[failure] : undefined;

  return (
    <div className="space-y-4">
      {devices.length > 1 && (
        <Fieldset columns={1}>
          <Field label="Microphone">
            <Select
              value={deviceId}
              onChange={setDeviceId}
              options={[{ value: "", label: "Micro par défaut" }, ...devices.map((d) => ({ value: d.deviceId, label: d.label || "Microphone" }))]}
            />
          </Field>
        </Fieldset>
      )}

      <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-6">
        <div className="text-2xl font-semibold tabular-nums">
          {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
        </div>
        <div className="h-2 w-48 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
          <div className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
        {state === "recording" ? (
          <Button variant="danger" onClick={stop}><Icon name="Square" size={15} /> Arrêter</Button>
        ) : (
          <Button variant="primary" onClick={() => void start()} disabled={starting}>
            <Icon name="Mic" size={15} /> {state === "recorded" ? "Réenregistrer" : "Démarrer"}
          </Button>
        )}
      </div>

      {problem && (
        <div className="space-y-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
          <p className="flex items-center gap-2">
            <Icon name="CircleAlert" size={16} /> {problem.message}
          </p>
          {problem.hint && <p className="text-xs text-[var(--ft-text-muted)]">{problem.hint}</p>}
          {problem.retry && (
            <Button size="sm" onClick={() => void start()} disabled={starting}>
              <Icon name="Mic" size={14} /> Autoriser le microphone
            </Button>
          )}
        </div>
      )}

      {blobUrl && state === "recorded" && (
        <div className="space-y-3">
          <audio controls src={blobUrl} className="w-full" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => save(true)} disabled={busy}><Icon name="HardDrive" size={14} /> Enregistrer en WAV</Button>
            <Button size="sm" onClick={() => save(false)} disabled={busy}><Icon name="HardDrive" size={14} /> Enregistrer (WebM)</Button>
          </div>
        </div>
      )}
    </div>
  );
}
