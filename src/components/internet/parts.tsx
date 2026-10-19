import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { Field, TextInput } from "@/components/pdf/Field";
import { isInternetAvailable, INTERNET_NATIVE_REQUIRED } from "@/core/internet/native";
import { looksLikeWebUrl } from "@/core/internet/format";
import { baseName, directoryName } from "@/core/files/paths";
import { openFolder, revealFile } from "@/core/output/save";
import { formatDecimalSize, t, tx } from "@/i18n";
import { notify } from "@/features/notifications/store";

/**
 * Briques communes aux outils Internet et aux nouveaux outils natifs.
 *
 * Elles portent ce qui doit se lire de la même façon partout : le repli quand
 * l'application n'est pas installée, la saisie d'une adresse, l'annonce de ce
 * qu'un outil contacte, et la restitution d'un fichier enregistré.
 */

/** Affiche `children` dans l'application, un repli explicite dans un navigateur. */
export function NativeGate({ children }: { children: ReactNode }) {
  if (!isInternetAvailable()) {
    return (
      <Callout tone="info" title={t("Application installée requise")}>
        {tx(INTERNET_NATIVE_REQUIRED)}
      </Callout>
    );
  }
  return <>{children}</>;
}

/** Ce que l'outil contacte, dit une fois, en tête. */
export function Contacts({ children }: { children: ReactNode }) {
  return (
    <Callout tone="neutral" icon="Wifi" data-testid="internet-contacts">
      {children}
    </Callout>
  );
}

export function UrlField({
  value,
  onChange,
  onSubmit,
  disabled,
  label = t("Adresse (URL)"),
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
}) {
  const invalid = value.trim().length > 0 && !looksLikeWebUrl(value);
  return (
    <Field label={label} hint={invalid ? t("L'adresse doit commencer par http:// ou https://") : hint} full>
      <TextInput
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        placeholder="https://"
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onSubmit && looksLikeWebUrl(value)) onSubmit();
        }}
        className="font-mono"
      />
    </Field>
  );
}

/** Un fichier enregistré : chemin, taille, et les deux gestes utiles. */
export function SavedFile({
  path,
  bytes,
  title = t("Fichier enregistré"),
  children,
}: {
  path: string;
  bytes?: number;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <Callout
      tone="success"
      title={title}
      actions={
        <>
          <Button size="sm" onClick={() => void revealFile(path)}>
            <Icon name="FolderTree" size={13} /> {t("Afficher")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void openFolder(directoryName(path))}>
            {t("Ouvrir le dossier")}
          </Button>
        </>
      }
    >
      <span className="break-all font-mono text-[12px]">{baseName(path)}</span>
      {bytes !== undefined && <span className="ml-2 tabular-nums">{formatDecimalSize(bytes)}</span>}
      <span className="mt-0.5 block break-all text-[11px] text-[var(--ft-text-faint)]">{path}</span>
      {children}
    </Callout>
  );
}

/** Copie un texte dans le presse-papiers, avec un retour. */
export function CopyButton({ text, label = t("Copier"), size = "sm" }: { text: string; label?: string; size?: "sm" | "md" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          notify.error(t("Copie impossible"), t("Le presse-papiers n'est pas accessible."));
        }
      }}
    >
      <Icon name={done ? "CircleCheck" : "Copy"} size={13} /> {done ? t("Copié") : tx(label)}
    </Button>
  );
}
