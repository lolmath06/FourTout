import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { CheckOption, TextPane } from "@/components/text/TextToolShell";
import { FileDropZone } from "@/components/files/FileDropZone";
import { formatFileSize, type SelectedFile } from "@/core/files";
import { notify } from "@/features/notifications/store";
import { saveFile } from "@/core/output/save";
import type { ToolComponentProps } from "../implementations";
import {
  base64ToBytes,
  bytesToBase64,
  decodeBase64,
  encodeBase64,
  fromDataUri,
  toDataUri,
} from "../logic/base64";

/**
 * Base64, texte et fichiers.
 *
 * Garde-fou volontaire côté fichier : au-delà de quelques mégaoctets, le
 * Base64 n'est pas affiché dans la zone de texte (elle deviendrait
 * inutilisable) — l'utilisateur l'enregistre directement en `.txt`.
 */
type Mode = "text" | "file";
type Direction = "encode" | "decode";

/** Au-delà, on n'affiche pas le résultat : on propose de l'enregistrer. */
const DISPLAY_LIMIT = 2 * 1024 * 1024;

export function Base64Tool(_props: ToolComponentProps) {
  const [mode, setMode] = useState<Mode>("text");

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field label="Type de contenu">
          <OptionGroup
            ariaLabel="Type de contenu"
            value={mode}
            onChange={setMode}
            options={[
              { value: "text", label: "Texte" },
              { value: "file", label: "Fichier" },
            ]}
          />
        </Field>
      </Fieldset>
      {mode === "text" ? <TextMode /> : <FileMode />}
    </div>
  );
}

function TextMode() {
  const [direction, setDirection] = useState<Direction>("encode");
  const [urlSafe, setUrlSafe] = useState(false);
  const [input, setInput] = useState("");

  const output = useMemo(() => {
    if (input.length === 0) return { value: "", error: null as string | null };
    try {
      return {
        value: direction === "encode" ? encodeBase64(input, urlSafe) : decodeBase64(input),
        error: null,
      };
    } catch {
      return {
        value: "",
        error:
          direction === "decode"
            ? "Entrée Base64 invalide : vérifiez qu'il ne manque aucun caractère."
            : "Encodage impossible.",
      };
    }
  }, [direction, input, urlSafe]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      notify.success("Résultat copié");
    } catch {
      notify.error("Copie impossible", "Le presse-papiers n'est pas accessible.");
    }
  };

  return (
    <div className="space-y-3">
      <Fieldset columns={2}>
        <Field label="Opération">
          <OptionGroup
            ariaLabel="Opération"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "encode", label: "Encoder" },
              { value: "decode", label: "Décoder" },
            ]}
          />
        </Field>
        {direction === "encode" && (
          <Field label="Variante">
            <CheckOption
              checked={urlSafe}
              onChange={setUrlSafe}
              label="base64url"
              hint="Compatible URL : - et _ au lieu de + et /"
            />
          </Field>
        )}
      </Fieldset>

      <div className="flex flex-col gap-3 lg:flex-row">
        <TextPane
          label={direction === "encode" ? "Texte à encoder" : "Base64 à décoder"}
          value={input}
          onChange={setInput}
          placeholder={direction === "encode" ? "Texte à encoder…" : "Base64 à décoder…"}
        />
        <TextPane label="Résultat" value={output.error ?? output.value} readOnly droppable={false} />
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setInput("")} disabled={!input}>
          <Icon name="Eraser" size={14} /> Effacer
        </Button>
        <Button size="sm" variant="primary" onClick={copy} disabled={!output.value}>
          <Icon name="Copy" size={14} /> Copier le résultat
        </Button>
      </div>
    </div>
  );
}

function FileMode() {
  const [direction, setDirection] = useState<Direction>("encode");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [encoded, setEncoded] = useState<{ text: string; size: number; name: string } | null>(null);
  const [dataUri, setDataUri] = useState(false);
  const [payload, setPayload] = useState("");
  const [targetName, setTargetName] = useState("fichier-decode.bin");
  const [error, setError] = useState<string | undefined>();

  const file = files[0];

  const encode = async () => {
    setError(undefined);
    if (!file?.file) return;
    const bytes = new Uint8Array(await file.file.arrayBuffer());
    const text = dataUri ? toDataUri(bytes, file.mimeType) : bytesToBase64(bytes);
    setEncoded({ text, size: bytes.length, name: file.name });
  };

  const saveEncoded = async () => {
    if (!encoded) return;
    const saved = await saveFile({
      name: `${encoded.name}.base64.txt`,
      bytes: new TextEncoder().encode(encoded.text),
      mimeType: "text/plain",
    });
    if (saved.saved) notify.success("Fichier enregistré", saved.path);
  };

  const decode = async () => {
    setError(undefined);
    try {
      const uri = fromDataUri(payload);
      const bytes = uri ? uri.bytes : base64ToBytes(payload);
      const saved = await saveFile({
        name: targetName.trim() || "fichier-decode.bin",
        bytes,
        mimeType: uri?.mimeType ?? "application/octet-stream",
      });
      if (saved.saved) notify.success("Fichier reconstruit", saved.path);
    } catch {
      setError("Entrée Base64 invalide : le fichier n'a pas pu être reconstruit.");
    }
  };

  return (
    <div className="space-y-3">
      <Fieldset columns={2}>
        <Field label="Opération">
          <OptionGroup
            ariaLabel="Opération"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "encode", label: "Fichier → Base64" },
              { value: "decode", label: "Base64 → fichier" },
            ]}
          />
        </Field>
        {direction === "encode" && (
          <Field label="Format de sortie">
            <CheckOption
              checked={dataUri}
              onChange={setDataUri}
              label="Data URI complet"
              hint="data:image/png;base64,… — à coller dans du HTML ou du CSS"
            />
          </Field>
        )}
      </Fieldset>

      {direction === "encode" ? (
        <>
          <FileDropZone
            constraints={{ inputs: [], maxFiles: 1 }}
            files={files}
            onChange={(next) => {
              setFiles(next);
              setEncoded(null);
            }}
            label="Déposez le fichier à encoder"
            hint="Tout type de fichier"
          />
          {file && (
            <div className="flex justify-end">
              <Button size="md" variant="primary" onClick={encode}>
                <Icon name="Play" size={15} /> Encoder en Base64
              </Button>
            </div>
          )}
          {encoded && (
            <div className="space-y-2">
              <p className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm tabular-nums">
                {formatFileSize(encoded.size)} → {formatFileSize(encoded.text.length)} de Base64
                {encoded.text.length > DISPLAY_LIMIT &&
                  " · trop volumineux pour être affiché, enregistrez-le en .txt"}
              </p>
              {encoded.text.length <= DISPLAY_LIMIT && (
                <TextPane label="Base64" value={encoded.text} readOnly droppable={false} minHeight="10rem" />
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={saveEncoded}>
                  <Icon name="Download" size={14} /> Enregistrer en .txt
                </Button>
                {encoded.text.length <= DISPLAY_LIMIT && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      await navigator.clipboard.writeText(encoded.text);
                      notify.success("Base64 copié");
                    }}
                  >
                    <Icon name="Copy" size={14} /> Copier
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <TextPane
            label="Base64 (ou data URI)"
            value={payload}
            onChange={setPayload}
            placeholder="Collez le Base64, ou déposez le fichier .txt qui le contient…"
            minHeight="12rem"
          />
          <Fieldset columns={1}>
            <Field label="Nom du fichier à reconstruire">
              <TextInput
                value={targetName}
                onChange={(event) => setTargetName(event.target.value)}
                aria-label="Nom du fichier"
              />
            </Field>
          </Fieldset>
          {error && (
            <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
              <Icon name="CircleAlert" size={16} /> {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button size="md" variant="primary" onClick={decode} disabled={payload.trim().length === 0}>
              <Icon name="Download" size={15} /> Reconstruire le fichier
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
