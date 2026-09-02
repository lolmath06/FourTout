import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, Select } from "@/components/pdf/Field";
import { AudioPreview } from "@/components/media/AudioPreview";
import { saveFile } from "@/core/output/save";
import { isMediaAvailable, runMedia } from "@/core/media/client";
import { convertAudio } from "@/core/media/operations/audio";
import { notify } from "@/features/notifications/store";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

type State = "idle" | "recording" | "recorded";

export function AudioRecordTool(_props: ToolComponentProps) {
  const [state, setState] = useState<State>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.()
      .then((list) => setDevices(list.filter((d) => d.kind === "audioinput")))
      .catch(() => {});
    return () => stopStream();
  }, []);

  const stopStream = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const start = async () => {
    setError(undefined);
    setBlob(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("L'enregistrement audio n'est pas disponible dans cet environnement.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => event.data.size > 0 && chunksRef.current.push(event.data);
      recorder.onstop = () => {
        setBlob(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
        setState("recorded");
        stopStream();
      };
      recorder.start();
      recorderRef.current = recorder;
      startRef.current = Date.now();
      setState("recording");
      meter(stream);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "Accès au microphone refusé. Autorisez le micro pour cette application."
          : name === "NotFoundError"
            ? "Aucun microphone détecté."
            : "Impossible d'accéder au microphone.",
      );
    }
  };

  const meter = (stream: MediaStream) => {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 128));
      setElapsed(Date.now() - startRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const stop = () => {
    recorderRef.current?.stop();
    cancelAnimationFrame(rafRef.current);
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
          <Button variant="primary" onClick={start}><Icon name="Mic" size={15} /> {state === "recorded" ? "Réenregistrer" : "Démarrer"}</Button>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} /> {error}
        </p>
      )}

      {blob && state === "recorded" && (
        <div className="space-y-3">
          <AudioPreview bytes={new Uint8Array(0)} />
          <audio controls src={URL.createObjectURL(blob)} className="w-full" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => save(true)} disabled={busy}><Icon name="HardDrive" size={14} /> Enregistrer en WAV</Button>
            <Button size="sm" onClick={() => save(false)} disabled={busy}><Icon name="HardDrive" size={14} /> Enregistrer (WebM)</Button>
          </div>
        </div>
      )}
    </div>
  );
}
