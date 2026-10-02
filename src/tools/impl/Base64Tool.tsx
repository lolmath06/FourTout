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
import { t, tx } from "@/i18n";

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
        <Field label={t("Type de contenu")}>
          <OptionGroup
            ariaLabel={t("Type de contenu")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "text", label: t("Texte") },
              { value: "file", label: t("Fichier") },
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
            ? t("Entrée Base64 invalide : vérifiez qu'il ne manque aucun caractère.")
            : t("Encodage impossible."),
      };
    }
  }, [direction, input, urlSafe]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      notify.success(t("Résultat copié"));
    } catch {
      notify.error(t("Copie impossible"), t("Le presse-papiers n'est pas accessible."));
    }
  };

  return (
    <div className="space-y-3">
      <Fieldset columns={2}>
        <Field label={t("Opération")}>
          <OptionGroup
            ariaLabel={t("Opération")}
            value={direction}
            onChange={setDirection}
            options={[
              { value: "encode", label: t("Encoder") },
              { value: "decode", label: t("Décoder") },
            ]}
          />
        </Field>
        {direction === "encode" && (
          <Field label={t("Variante")}>
            <CheckOption
              checked={urlSafe}
              onChange={setUrlSafe}
              label="base64url"
              hint={t("Compatible URL : - et _ au lieu de + et /")}
            />
          </Field>
        )}
      </Fieldset>

      <div className="flex flex-col gap-3 lg:flex-row">
        <TextPane
          label={direction === "encode" ? t("Texte à encoder") : t("Base64 à décoder")}
          value={input}
          onChange={setInput}
          placeholder={direction === "encode" ? t("Texte à encoder…") : t("Base64 à décoder…")}
        />
        <TextPane label={t("Résultat")} value={output.error ?? output.value} readOnly droppable={false} />
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setInput("")} disabled={!input}>
          <Icon name="Eraser" size={14} />{" "}{t("Effacer")}
        </Button>
        <Button size="sm" variant="primary" onClick={copy} disabled={!output.value}>
          <Icon name="Copy" size={14} />{" "}{t("Copier le résultat")}
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
      name: t("{name}.base64.txt", { name: encoded.name }),
      bytes: new TextEncoder().encode(encoded.text),
      mimeType: "text/plain",
    });
    if (saved.saved) notify.success(t("Fichier enregistré"), saved.path);
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
      if (saved.saved) notify.success(t("Fichier reconstruit"), saved.path);
    } catch {
      setError(t("Entrée Base64 invalide : le fichier n'a pas pu être reconstruit."));
    }
  };

  return (
    <div className="space-y-3">
      <Fieldset columns={2}>
        <Field label={t("Opération")}>
          <OptionGroup
            ariaLabel={t("Opération")}
            value={direction}
            onChange={setDirection}
            options={[
              { value: "encode", label: t("Fichier → Base64") },
              { value: "decode", label: t("Base64 → fichier") },
            ]}
          />
        </Field>
        {direction === "encode" && (
          <Field label={t("Format de sortie")}>
            <CheckOption
              checked={dataUri}
              onChange={setDataUri}
              label={t("Data URI complet")}
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
            label={t("Déposez le fichier à encoder")}
            hint={t("Tout type de fichier")}
          />
          {file && (
            <div className="flex justify-end">
              <Button size="md" variant="primary" onClick={encode}>
                <Icon name="Play" size={15} />{" "}{t("Encoder en Base64")}
              </Button>
            </div>
          )}
          {encoded && (
            <div className="space-y-2">
              <p className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm tabular-nums">
                {t("{size} → {size2} de Base64{value}", { size: formatFileSize(encoded.size), size2: formatFileSize(encoded.text.length), value: encoded.text.length > DISPLAY_LIMIT &&
                  t(" · trop volumineux pour être affiché, enregistrez-le en .txt") })}
              </p>
              {encoded.text.length <= DISPLAY_LIMIT && (
                <TextPane label={t("Base64")} value={encoded.text} readOnly droppable={false} minHeight="10rem" />
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={saveEncoded}>
                  <Icon name="Download" size={14} />{" "}{t("Enregistrer en .txt")}
                </Button>
                {encoded.text.length <= DISPLAY_LIMIT && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      await navigator.clipboard.writeText(encoded.text);
                      notify.success(t("Base64 copié"));
                    }}
                  >
                    <Icon name="Copy" size={14} />{" "}{t("Copier")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <TextPane
            label={t("Base64 (ou data URI)")}
            value={payload}
            onChange={setPayload}
            placeholder={t("Collez le Base64, ou déposez le fichier .txt qui le contient…")}
            minHeight="12rem"
          />
          <Fieldset columns={1}>
            <Field label={t("Nom du fichier à reconstruire")}>
              <TextInput
                value={targetName}
                onChange={(event) => setTargetName(event.target.value)}
                aria-label={t("Nom du fichier")}
              />
            </Field>
          </Fieldset>
          {error && (
            <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
              <Icon name="CircleAlert" size={16} /> {tx(error)}
            </p>
          )}
          <div className="flex justify-end">
            <Button size="md" variant="primary" onClick={decode} disabled={payload.trim().length === 0}>
              <Icon name="Download" size={15} />{" "}{t("Reconstruire le fichier")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
