import { useEffect, useState } from "react";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PasswordField } from "@/components/files/PasswordField";
import { PathPicker } from "@/components/files/PathPicker";
import { Panel } from "@/components/files/Summary";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import { hmacFile, hmacText, type HmacAlgorithm, type HmacResult } from "@/core/files/native";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Calcul d'un HMAC sur un texte ou un fichier.
 *
 * Le traitement de la **clé** est le cœur de cet outil, pas le calcul :
 *
 * - elle n'est jamais écrite dans les récents, ni journalisée, ni persistée ;
 * - elle traverse l'IPC une seule fois, sert au calcul, et disparaît avec
 *   l'appel ;
 * - elle est effacée de l'écran dès qu'on quitte l'outil, sans quoi un
 *   secret resterait affiché derrière un onglet ouvert depuis une heure.
 *
 * Le fichier, lui, est lu en flux : un HMAC sur une image disque de 40 Go se
 * calcule sans que rien ne passe en mémoire.
 */
const ALGORITHMS: { value: HmacAlgorithm; label: string; hint: string }[] = [
  { value: "sha256", label: "HMAC-SHA-256", hint: "Le choix usuel : webhooks, signatures d'API, jetons." },
  { value: "sha512", label: "HMAC-SHA-512", hint: "Même usage, empreinte plus longue." },
  {
    value: "sha1",
    label: "HMAC-SHA-1",
    hint: "Hérité. Contrairement à SHA-1 nu, HMAC-SHA-1 n'est pas cassé — mais ne l'employez que si un service ancien l'exige.",
  },
];

export function HmacTool(_props: ToolComponentProps) {
  const [source, setSource] = useState<"text" | "file">("text");
  const [algorithm, setAlgorithm] = useState<HmacAlgorithm>("sha256");
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const action = useNativeAction<HmacResult>();

  // La clé ne survit pas à la page : quitter l'outil l'efface de la mémoire du
  // composant comme de l'écran.
  useEffect(() => () => setKey(""), []);

  if (!isNativeAvailable()) return <NativeRequired />;

  const ready = key.length > 0 && (source === "text" ? text.length > 0 : paths.length > 0);

  const run = () =>
    void action.execute((context) =>
      source === "text"
        ? hmacText(algorithm, key, text)
        : hmacFile(algorithm, key, paths[0], context),
    );

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify.success("Copié", label);
    } catch {
      notify.error("Copie impossible", "Le presse-papiers n'est pas accessible.");
    }
  };

  return (
    <div className="space-y-4">
      <Fieldset columns={2} title="Calcul">
        <Field label="Entrée">
          <OptionGroup
            ariaLabel="Nature de l'entrée"
            value={source}
            onChange={(next) => {
              setSource(next);
              action.setResult(null);
            }}
            options={[
              { value: "text", label: "Texte" },
              { value: "file", label: "Fichier" },
            ]}
          />
        </Field>
        <Field label="Algorithme" hint={ALGORITHMS.find((entry) => entry.value === algorithm)?.hint}>
          <OptionGroup
            ariaLabel="Algorithme HMAC"
            value={algorithm}
            onChange={(next) => {
              setAlgorithm(next);
              action.setResult(null);
            }}
            options={ALGORITHMS}
          />
        </Field>
        <PasswordField
          value={key}
          onChange={(next) => {
            setKey(next);
            action.setResult(null);
          }}
          label="Clé secrète"
          hint="Elle n'est ni enregistrée, ni journalisée, ni ajoutée aux récents. Elle disparaît quand vous quittez l'outil."
        />
      </Fieldset>

      {source === "text" ? (
        <Fieldset columns={1} title="Message">
          <Field label="Texte à signer" full>
            <textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                action.setResult(null);
              }}
              rows={6}
              aria-label="Texte à signer"
              className="w-full rounded-[var(--radius-md)] border border-[var(--ft-border-strong)] bg-[var(--ft-bg)] px-2 py-1.5 font-mono text-[13px] outline-none focus:border-[var(--ft-accent)]"
            />
          </Field>
        </Fieldset>
      ) : (
        <PathPicker
          mode="files"
          paths={paths}
          onChange={(next) => {
            setPaths(next);
            action.setResult(null);
          }}
          label="Fichier à signer"
          hint="lu en flux : la taille n'a pas d'importance"
        />
      )}

      <RunBar
        label="Calculer le HMAC"
        icon="KeyRound"
        disabled={!ready}
        running={action.job.isRunning}
        progress={action.job.progress}
        status={action.job.status}
        error={action.error}
        cancel={action.job.cancel}
        onRun={run}
      />

      {action.result && (
        <Panel title={`${action.result.algorithm} — ${formatFileSize(action.result.bytes)} couverts`} testId="hmac-result">
          <div className="space-y-2 p-3">
            <Output
              label="Hexadécimal"
              value={action.result.hex}
              onCopy={() => void copy(action.result!.hex, "HMAC hexadécimal")}
            />
            <Output
              label="Base64"
              value={action.result.base64}
              onCopy={() => void copy(action.result!.base64, "HMAC Base64")}
            />
          </div>
        </Panel>
      )}

      <Callout tone="info" title="Ce qu'un HMAC prouve">
        Qu'un message a bien été produit par quelqu'un qui connaît la clé, et qu'il n'a pas été
        modifié depuis. Il ne chiffre rien : le message reste lisible par tous.
      </Callout>
    </div>
  );
}

function Output({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="ft-label w-24 shrink-0 pt-1.5">{label}</span>
      <code className="min-w-0 flex-1 break-all rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] px-2 py-1.5 font-mono text-[12px]">
        {value}
      </code>
      <Button size="sm" variant="ghost" onClick={onCopy} aria-label={`Copier le HMAC ${label}`}>
        <Icon name="Copy" size={13} />
      </Button>
    </div>
  );
}
