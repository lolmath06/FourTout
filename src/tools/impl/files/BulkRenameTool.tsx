import { useCallback, useEffect, useState } from "react";
import { CheckOption } from "@/components/text/TextToolShell";
import { PathPicker } from "@/components/files/PathPicker";
import { Field, Fieldset, NumberInput, OptionGroup, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { isFilesEngineAvailable, NATIVE_REQUIRED } from "@/core/files/native";
import {
  DEFAULT_RENAME_RULES,
  renameApply,
  renamePlan,
  type CaseRule,
  type RenamePlan,
  type RenameRules,
} from "@/core/files/native";
import { notify } from "@/features/notifications/store";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Renommage par lot, et nettoyage des noms de fichiers.
 *
 * Règle absolue : **l'aperçu précède toujours l'application**. Les collisions
 * (deux fichiers qui deviendraient le même, ou un nom déjà pris) et les noms
 * refusés par Windows sont détectés avant d'écrire quoi que ce soit, et
 * bloquent l'application tant qu'ils ne sont pas résolus.
 */
export function BulkRenameTool({ tool }: ToolComponentProps) {
  const cleanMode = tool.id === "file-clean-names";
  const received = useHandoffPaths(tool.id);
  const [paths, setPaths] = useState<string[]>(received);
  const [rules, setRules] = useState<RenameRules>({
    ...DEFAULT_RENAME_RULES,
    sanitize: cleanMode,
    lowercaseExtension: cleanMode,
  });
  const [plan, setPlan] = useState<RenamePlan | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (paths.length === 0 || !isFilesEngineAvailable()) {
      setPlan(null);
      return;
    }
    try {
      setPlan(await renamePlan(paths, rules));
    } catch (error) {
      notify.error("Aperçu impossible", error instanceof Error ? error.message : undefined);
    }
  }, [paths, rules]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const set = <K extends keyof RenameRules>(key: K, value: RenameRules[K]) =>
    setRules((current) => ({ ...current, [key]: value }));

  const apply = async () => {
    if (!plan || plan.problems > 0) return;
    setBusy(true);
    try {
      const outcome = await renameApply(paths, rules);
      notify.success(
        `${outcome.renamed} fichier(s) renommé(s)`,
        outcome.errors.length > 0 ? outcome.errors[0] : undefined,
      );
      // Les chemins ont changé : on repart d'une sélection propre.
      setPaths([]);
      setPlan(null);
    } catch (error) {
      notify.error("Renommage impossible", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  if (!isFilesEngineAvailable()) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-4 text-sm text-[var(--ft-text-muted)]">
        <p className="flex items-center gap-2 font-medium text-[var(--ft-text)]">
          <Icon name="Info" size={16} /> Application installée requise
        </p>
        <p className="mt-1.5">{NATIVE_REQUIRED}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PathPicker
        mode="files"
        paths={paths}
        onChange={setPaths}
        multiple
        label="Choisissez les fichiers à renommer"
        hint="L'ordre de la liste détermine la numérotation."
        disabled={busy}
      />

      {paths.length > 0 && (
        <>
          <Fieldset columns={3}>
            <Field label="Préfixe">
              <TextInput
                value={rules.prefix}
                onChange={(event) => set("prefix", event.target.value)}
                placeholder="vacances-"
                aria-label="Préfixe"
              />
            </Field>
            <Field label="Suffixe">
              <TextInput
                value={rules.suffix}
                onChange={(event) => set("suffix", event.target.value)}
                placeholder="-final"
                aria-label="Suffixe"
              />
            </Field>
            <Field label="Casse du nom">
              <OptionGroup
                ariaLabel="Casse du nom"
                value={rules.caseRule}
                onChange={(value: CaseRule) => set("caseRule", value)}
                options={[
                  { value: "keep", label: "Inchangée" },
                  { value: "lower", label: "minuscules" },
                  { value: "upper", label: "MAJUSCULES" },
                  { value: "title", label: "Initiales" },
                ]}
              />
            </Field>

            <Field label="Remplacer">
              <TextInput
                value={rules.find}
                onChange={(event) => set("find", event.target.value)}
                placeholder="IMG_"
                aria-label="Texte à remplacer"
              />
            </Field>
            <Field label="Par">
              <TextInput
                value={rules.replace}
                onChange={(event) => set("replace", event.target.value)}
                placeholder="photo"
                aria-label="Texte de remplacement"
              />
            </Field>
            <Field label="Numérotation">
              <CheckOption
                checked={rules.numbering}
                onChange={(value) => set("numbering", value)}
                label="Ajouter un numéro"
              />
            </Field>

            <Field label="Retirer au début" hint="Nombre de caractères">
              <NumberInput
                min={0}
                value={rules.trimStart}
                onChange={(event) => set("trimStart", Math.max(0, Number(event.target.value) || 0))}
                aria-label="Caractères à retirer au début"
              />
            </Field>
            <Field label="Retirer à la fin" hint="Nombre de caractères">
              <NumberInput
                min={0}
                value={rules.trimEnd}
                onChange={(event) => set("trimEnd", Math.max(0, Number(event.target.value) || 0))}
                aria-label="Caractères à retirer à la fin"
              />
            </Field>
            {rules.numbering && (
              <Field label="Premier numéro / chiffres">
                <div className="flex gap-2">
                  <NumberInput
                    min={0}
                    value={rules.numberStart}
                    onChange={(event) => set("numberStart", Math.max(0, Number(event.target.value) || 0))}
                    aria-label="Premier numéro"
                  />
                  <NumberInput
                    min={1}
                    max={8}
                    value={rules.numberPadding}
                    onChange={(event) =>
                      set("numberPadding", Math.min(8, Math.max(1, Number(event.target.value) || 1)))
                    }
                    aria-label="Nombre de chiffres"
                  />
                </div>
              </Field>
            )}

            <Field label="Options" full>
              <div className="grid gap-0.5 sm:grid-cols-3">
                <CheckOption
                  checked={rules.sanitize}
                  onChange={(value) => set("sanitize", value)}
                  label="Nettoyer les noms"
                  hint="Accents, espaces et caractères spéciaux"
                />
                <CheckOption
                  checked={rules.lowercaseExtension}
                  onChange={(value) => set("lowercaseExtension", value)}
                  label="Extension en minuscules"
                />
                {rules.numbering && (
                  <CheckOption
                    checked={rules.numberPosition === "prefix"}
                    onChange={(value) => set("numberPosition", value ? "prefix" : "suffix")}
                    label="Numéro au début du nom"
                  />
                )}
              </div>
            </Field>
          </Fieldset>

          {plan && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <Icon name="Eye" size={15} /> Aperçu
                </span>
                <span className="tabular-nums">{plan.changed} renommage(s)</span>
                {plan.problems > 0 && (
                  <span className="flex items-center gap-1.5 tabular-nums text-[var(--ft-danger)]">
                    <Icon name="CircleAlert" size={14} /> {plan.problems} conflit(s)
                  </span>
                )}
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={apply}
                  disabled={busy || plan.problems > 0 || plan.changed === 0}
                >
                  <Icon name="PenLine" size={14} /> Appliquer le renommage
                </Button>
              </div>

              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--ft-border)]">
                <table className="w-full border-collapse text-xs" data-testid="rename-preview">
                  <thead>
                    <tr className="border-b border-[var(--ft-border)] text-left text-[var(--ft-text-muted)]">
                      <th className="px-3 py-1.5 font-medium">Nom actuel</th>
                      <th className="px-3 py-1.5 font-medium">Nouveau nom</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.entries.map((entry) => (
                      <tr
                        key={entry.path}
                        className={
                          entry.problem
                            ? "bg-[color-mix(in_oklch,var(--ft-danger)_10%,transparent)]"
                            : entry.changed
                              ? "bg-[color-mix(in_oklch,var(--ft-ok)_7%,transparent)]"
                              : ""
                        }
                      >
                        <td className="px-3 py-1 font-mono">{entry.from}</td>
                        <td className="px-3 py-1 font-mono">
                          {entry.problem ? (
                            <span className="text-[var(--ft-danger)]">
                              {entry.to} — {entry.problem}
                            </span>
                          ) : entry.changed ? (
                            entry.to
                          ) : (
                            <span className="text-[var(--ft-text-faint)]">inchangé</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="flex items-start gap-2 text-xs text-[var(--ft-text-muted)]">
                <Icon name="ShieldCheck" size={13} className="mt-px shrink-0" />
                Aucun fichier n'est écrasé : les conflits bloquent le renommage tant qu'ils ne sont
                pas résolus, et l'application se fait en deux temps pour permettre les permutations.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
