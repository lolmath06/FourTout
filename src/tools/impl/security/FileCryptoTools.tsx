import { useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { PasswordField, passwordReady } from "@/components/files/PasswordField";
import { Field, Fieldset } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { formatFileSize } from "@/core/files";
import {
  decryptFiles,
  encryptFiles,
  ENCRYPTED_EXTENSION,
  pickDirectory,
  type CryptoSummary,
} from "@/core/files/native";
import { baseName } from "@/core/files/paths";
import { revealFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Chiffrement et déchiffrement partagent un seul moteur natif (Argon2id +
 * XChaCha20-Poly1305, par blocs authentifiés). Ces deux écrans n'en sont que
 * les deux faces : mêmes garanties, mêmes messages, même format `.ftenc`.
 */

function ResultList({
  results,
  verb,
}: {
  results: CryptoSummary[];
  verb: "chiffré" | "déchiffré";
}) {
  return (
    <div
      className="rounded-[var(--radius-card)] border border-l-2 border-[var(--ft-border)] bg-[var(--ft-surface)]"
      style={{ borderLeftColor: "var(--ft-ok)" }}
    >
      <div className="flex items-start gap-2 border-b border-[var(--ft-rule)] px-3 py-2">
        <Icon name="CircleCheck" size={15} className="mt-px shrink-0 text-[var(--ft-ok)]" />
        <p className="text-[13px] font-medium leading-5">
          {results.length} fichier{results.length > 1 ? "s" : ""} {verb}
          {results.length > 1 ? "s" : ""}
        </p>
      </div>
      <ul className="divide-y divide-[var(--ft-rule)]">
        {results.map((result) => (
          <li key={result.path} className="ft-row-py px-3">
            <p className="ft-value break-all text-[var(--ft-text)]">{baseName(result.path)}</p>
            <p className="ft-meta ft-num">
              {formatFileSize(result.inputBytes)} → {formatFileSize(result.outputBytes)}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5 border-t border-[var(--ft-rule)] px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => revealFile(results[0].path)}>
          <Icon name="FolderTree" size={13} /> Ouvrir le dossier
        </Button>
      </div>
    </div>
  );
}

/** Sélection facultative d'un dossier de sortie, commune aux deux outils. */
function DestinationField({
  destination,
  onChange,
}: {
  destination: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field
      label="Dossier de sortie"
      hint={destination ? destination : "Par défaut : à côté du fichier d'origine."}
    >
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={async () => {
            const chosen = await pickDirectory("Dossier de sortie");
            if (chosen) onChange(chosen);
          }}
        >
          <Icon name="FolderTree" size={13} /> Choisir
        </Button>
        {destination && (
          <Button size="sm" variant="ghost" onClick={() => onChange("")}>
            Par défaut
          </Button>
        )}
      </div>
    </Field>
  );
}

export function FileEncryptTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [destination, setDestination] = useState("");

  return (
    <NativeToolShell<CryptoSummary[]>
      picker={{
        mode: "files",
        paths,
        onChange: setPaths,
        multiple: true,
        label: "Choisissez les fichiers à chiffrer",
        hint: "Tout type de fichier. L'original n'est jamais supprimé.",
      }}
      actionLabel="Chiffrer"
      actionIcon="Lock"
      actionDisabled={paths.length === 0 || !passwordReady(password, confirmation)}
      run={(context) =>
        encryptFiles(paths, destination || undefined, password, context)
      }
      successMessage={(results) =>
        `${results.length} fichier${results.length > 1 ? "s" : ""} chiffré${results.length > 1 ? "s" : ""}`
      }
      renderResult={(results) => <ResultList results={results} verb="chiffré" />}
      footer={
        <Callout tone="warning" title="Un mot de passe perdu est un fichier perdu">
          Il n'existe aucune porte dérobée, aucune clé de secours et aucun moyen de récupération :
          c'est précisément ce qui rend le chiffrement utile. Notez votre mot de passe ailleurs
          avant de fermer cet écran.
        </Callout>
      }
    >
      <Fieldset columns={2} title="Protection">
        <PasswordField
          value={password}
          onChange={setPassword}
          confirmation={confirmation}
          onConfirmationChange={setConfirmation}
          hint="Une phrase longue vaut mieux qu'un mot court et compliqué."
        />
        <DestinationField destination={destination} onChange={setDestination} />
      </Fieldset>

      <Callout tone="info" title="Ce que produit FourTout">
        Un fichier <span className="ft-value">.{ENCRYPTED_EXTENSION}</span> chiffré avec
        XChaCha20-Poly1305, dont la clé est dérivée de votre mot de passe par Argon2id. Chaque bloc
        est authentifié : la moindre modification du fichier chiffré est détectée au
        déchiffrement, et rien n'est produit dans ce cas.
      </Callout>
    </NativeToolShell>
  );
}

export function FileDecryptTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [destination, setDestination] = useState("");

  return (
    <NativeToolShell<CryptoSummary[]>
      picker={{
        mode: "files",
        paths,
        onChange: setPaths,
        multiple: true,
        label: `Choisissez les fichiers .${ENCRYPTED_EXTENSION} à déchiffrer`,
        hint: "Seuls les fichiers produits par FourTout sont reconnus.",
        filters: [{ name: "FourTout chiffré", extensions: [ENCRYPTED_EXTENSION] }],
      }}
      actionLabel="Déchiffrer"
      actionIcon="LockOpen"
      actionDisabled={paths.length === 0 || !passwordReady(password)}
      run={(context) => decryptFiles(paths, destination || undefined, password, context)}
      successMessage={(results) =>
        `${results.length} fichier${results.length > 1 ? "s" : ""} déchiffré${results.length > 1 ? "s" : ""}`
      }
      renderResult={(results) => <ResultList results={results} verb="déchiffré" />}
      footer={
        <Callout tone="info" title="Mot de passe faux, fichier altéré : rien n'est produit">
          Le déchiffrement vérifie l'authenticité de chaque bloc avant d'écrire quoi que ce soit.
          Un mot de passe incorrect, un fichier modifié ou tronqué font échouer l'opération sans
          laisser de fichier partiel qu'on prendrait pour un résultat.
        </Callout>
      }
    >
      <Fieldset columns={2} title="Déverrouillage">
        <PasswordField
          value={password}
          onChange={setPassword}
          autoFocus
          hint="Le mot de passe utilisé lors du chiffrement."
        />
        <DestinationField destination={destination} onChange={setDestination} />
      </Fieldset>
    </NativeToolShell>
  );
}
