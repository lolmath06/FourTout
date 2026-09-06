import { useEffect, useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { PasswordField, passwordReady } from "@/components/files/PasswordField";
import { Field, Fieldset, OptionGroup, Slider, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { formatFileSize } from "@/core/files";
import {
  createEncryptedArchive,
  extractEncryptedArchive,
  listArchive,
  pickDirectory,
  type ArchiveListing,
  type ArchiveSummary,
  type ExtractSummary,
} from "@/core/files/native";
import { baseName, directoryName, joinPath, stemOf } from "@/core/files/paths";
import { revealFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

type Mode = "create" | "extract";

/**
 * Archive ZIP protégée par mot de passe.
 *
 * Le chiffrement est **WinZip AES-256**, celui que lisent 7-Zip, WinRAR,
 * PeaZip, Keka et l'Explorateur de Windows. Le « ZipCrypto » historique n'est
 * jamais utilisé : il se casse à partir de quelques octets de contenu connu,
 * et une archive qui donne un faux sentiment de sécurité est pire qu'une
 * archive ouverte.
 *
 * Limite à dire clairement : dans un ZIP chiffré, **les noms des fichiers
 * restent lisibles** sans mot de passe. C'est le format qui veut ça. Pour
 * cacher jusqu'aux noms, il faut chiffrer l'archive entière avec l'outil
 * « Chiffrer des fichiers ».
 */
export function EncryptedArchiveTool(_props: ToolComponentProps) {
  const [mode, setMode] = useState<Mode>("create");

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field label="Opération">
          <OptionGroup
            ariaLabel="Opération"
            value={mode}
            onChange={setMode}
            options={[
              { value: "create", label: "Créer une archive protégée" },
              { value: "extract", label: "Extraire une archive protégée" },
            ]}
          />
        </Field>
      </Fieldset>
      {mode === "create" ? <CreateMode /> : <ExtractMode />}
    </div>
  );
}

function CreateMode() {
  const [paths, setPaths] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [level, setLevel] = useState(6);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");

  const defaultName = paths[0] ? stemOf(baseName(paths[0])) : "archive-protegee";
  const finalName = `${(name.trim() || defaultName).replace(/\.zip$/i, "")}.zip`;
  const target = destination || (paths[0] ? directoryName(paths[0]) : "");
  const output = target ? joinPath(target, finalName) : "";

  return (
    <NativeToolShell<ArchiveSummary>
      picker={{
        mode: "files",
        paths,
        onChange: (next) => {
          setPaths(next);
          setDestination("");
        },
        multiple: true,
        label: "Choisissez les fichiers à protéger",
        hint: "Déposez aussi des dossiers : leur arborescence est conservée.",
      }}
      actionLabel="Créer l'archive protégée"
      actionIcon="Lock"
      actionDisabled={output.length === 0 || !passwordReady(password, confirmation)}
      run={(context) => createEncryptedArchive(paths, output, level, password, context)}
      successMessage={(summary) =>
        `${summary.files} fichiers → ${formatFileSize(summary.outputBytes)}`
      }
      renderResult={(summary) => (
        <div
          className="rounded-[var(--radius-card)] border border-l-2 border-[var(--ft-border)] bg-[var(--ft-surface)]"
          style={{ borderLeftColor: "var(--ft-ok)" }}
        >
          <div className="flex items-start gap-2 border-b border-[var(--ft-rule)] px-3 py-2">
            <Icon name="CircleCheck" size={15} className="mt-px shrink-0 text-[var(--ft-ok)]" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-5">
                Archive protégée créée — {summary.files} fichier{summary.files > 1 ? "s" : ""}
              </p>
              <p className="ft-value break-all text-[var(--ft-text-muted)]">{summary.path}</p>
            </div>
          </div>
          <p className="ft-meta ft-num px-3 py-1.5">
            {formatFileSize(summary.inputBytes)} → {formatFileSize(summary.outputBytes)}
          </p>
          <div className="border-t border-[var(--ft-rule)] px-3 py-2">
            <Button size="sm" variant="ghost" onClick={() => revealFile(summary.path)}>
              <Icon name="FolderTree" size={13} /> Ouvrir le dossier
            </Button>
          </div>
        </div>
      )}
      footer={
        <>
          <Callout tone="info" title="AES-256, pas ZipCrypto">
            L'archive utilise le chiffrement WinZip AES-256, lu par 7-Zip, WinRAR, PeaZip, Keka et
            l'Explorateur de Windows. Le « ZipCrypto » historique n'est jamais employé : il se
            casse à partir de quelques octets de contenu connu.
          </Callout>
          <Callout tone="warning" title="Les noms de fichiers restent visibles">
            Dans un ZIP chiffré, seul le contenu l'est : la liste des fichiers et leurs tailles se
            lisent sans mot de passe. Pour masquer jusqu'aux noms, chiffrez l'archive terminée avec
            l'outil « Chiffrer des fichiers ».
          </Callout>
        </>
      }
    >
      <Fieldset columns={2} title="Protection">
        <PasswordField
          value={password}
          onChange={setPassword}
          confirmation={confirmation}
          onConfirmationChange={setConfirmation}
        />
        <Field label="Nom de l'archive" hint={output || "Choisissez d'abord des fichiers."}>
          <TextInput
            value={name}
            placeholder={defaultName}
            onChange={(event) => setName(event.target.value)}
            aria-label="Nom de l'archive"
          />
        </Field>
        <Field label={`Compression (${level})`} hint="0 = aucune, 9 = maximale mais plus lente.">
          <Slider value={level} min={0} max={9} step={1} onChange={setLevel} />
        </Field>
        <Field label="Dossier de sortie" hint={destination || "Par défaut : à côté des fichiers."}>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                const chosen = await pickDirectory("Dossier de sortie");
                if (chosen) setDestination(chosen);
              }}
            >
              <Icon name="FolderTree" size={13} /> Choisir
            </Button>
            {destination && (
              <Button size="sm" variant="ghost" onClick={() => setDestination("")}>
                Par défaut
              </Button>
            )}
          </div>
        </Field>
      </Fieldset>
    </NativeToolShell>
  );
}

function ExtractMode() {
  const [paths, setPaths] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [destination, setDestination] = useState("");
  const [listing, setListing] = useState<ArchiveListing | undefined>();
  const [listingError, setListingError] = useState<string | undefined>();

  // Le contenu d'un ZIP chiffré se lit sans mot de passe : autant montrer
  // à l'utilisateur ce qu'il s'apprête à extraire.
  useEffect(() => {
    let cancelled = false;
    if (paths.length === 0) {
      setListing(undefined);
      setListingError(undefined);
      return;
    }
    void listArchive(paths[0])
      .then((result) => {
        if (!cancelled) {
          setListing(result);
          setListingError(undefined);
        }
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setListing(undefined);
        setListingError(failure instanceof Error ? failure.message : "Archive illisible.");
      });
    return () => {
      cancelled = true;
    };
  }, [paths]);

  const target = destination || (paths[0] ? directoryName(paths[0]) : "");

  return (
    <NativeToolShell<ExtractSummary>
      picker={{
        mode: "files",
        paths,
        onChange: setPaths,
        label: "Choisissez l'archive protégée",
        hint: "ZIP chiffré (AES ou ZipCrypto).",
        filters: [{ name: "Archive ZIP", extensions: ["zip"] }],
      }}
      actionLabel="Extraire"
      actionIcon="LockOpen"
      actionDisabled={paths.length === 0 || target.length === 0 || !passwordReady(password)}
      run={(context) => extractEncryptedArchive(paths[0], target, false, password, context)}
      successMessage={(summary) => `${summary.extracted} fichiers extraits`}
      renderResult={(summary) => (
        <div
          className="rounded-[var(--radius-card)] border border-l-2 border-[var(--ft-border)] bg-[var(--ft-surface)]"
          style={{ borderLeftColor: "var(--ft-ok)" }}
        >
          <div className="flex items-start gap-2 border-b border-[var(--ft-rule)] px-3 py-2">
            <Icon name="CircleCheck" size={15} className="mt-px shrink-0 text-[var(--ft-ok)]" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-5">
                {summary.extracted} fichier{summary.extracted > 1 ? "s" : ""} extrait
                {summary.extracted > 1 ? "s" : ""} — {formatFileSize(summary.bytes)}
              </p>
              <p className="ft-value break-all text-[var(--ft-text-muted)]">{summary.destination}</p>
            </div>
          </div>
          {summary.skipped.length > 0 && (
            <ul className="divide-y divide-[var(--ft-rule)]">
              {summary.skipped.map((entry) => (
                <li key={entry} className="ft-meta ft-row-py px-3 text-[var(--ft-warn)]">
                  {entry}
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-[var(--ft-rule)] px-3 py-2">
            <Button size="sm" variant="ghost" onClick={() => revealFile(summary.destination)}>
              <Icon name="FolderTree" size={13} /> Ouvrir le dossier
            </Button>
          </div>
        </div>
      )}
      footer={
        listingError ? (
          <Callout tone="error" title="Archive illisible">
            {listingError}
          </Callout>
        ) : listing && !listing.encrypted ? (
          <Callout tone="info" title="Archive non protégée">
            Cette archive n'est pas chiffrée : le mot de passe sera ignoré. L'outil « Extraire une
            archive » convient mieux.
          </Callout>
        ) : undefined
      }
    >
      <Fieldset columns={2} title="Déverrouillage">
        <PasswordField value={password} onChange={setPassword} autoFocus />
        <Field label="Dossier de destination" hint={target || "Par défaut : à côté de l'archive."}>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                const chosen = await pickDirectory("Dossier de destination");
                if (chosen) setDestination(chosen);
              }}
            >
              <Icon name="FolderTree" size={13} /> Choisir
            </Button>
            {destination && (
              <Button size="sm" variant="ghost" onClick={() => setDestination("")}>
                Par défaut
              </Button>
            )}
          </div>
        </Field>
      </Fieldset>

      {listing && (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
          <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
            Contenu annoncé — {listing.files} fichier{listing.files > 1 ? "s" : ""},{" "}
            {formatFileSize(listing.totalSize)}
            {listing.encrypted ? " · protégé par mot de passe" : ""}
          </h3>
          <ul className="max-h-56 divide-y divide-[var(--ft-rule)] overflow-y-auto">
            {listing.entries.slice(0, 200).map((entry) => (
              <li key={entry.name} className="ft-row-py flex items-center gap-2 px-3">
                <Icon
                  name={entry.isDir ? "FolderTree" : "File"}
                  size={13}
                  className="shrink-0 text-[var(--ft-text-faint)]"
                />
                <span className="ft-value min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.rejected ? (
                  <span className="ft-meta shrink-0 text-[var(--ft-danger)]">{entry.rejected}</span>
                ) : (
                  <span className="ft-value shrink-0 text-[var(--ft-text-muted)]">
                    {formatFileSize(entry.size)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </NativeToolShell>
  );
}
