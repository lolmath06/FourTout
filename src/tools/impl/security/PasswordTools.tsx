import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, NumberInput, OptionGroup, TextInput } from "@/components/pdf/Field";
import { CheckOption, TextPane } from "@/components/text/TextToolShell";
import { CopyButton, InputError, ResultBlock, ValueTable } from "@/components/calc/CalcShell";
import {
  alphabetFor,
  crackTime,
  DEFAULT_OPTIONS,
  entropyBits,
  evaluatePassword,
  generatePassphrase,
  generatePasswords,
  GUESSES_PER_SECOND,
  MAX_COUNT,
  MAX_LENGTH,
  MIN_LENGTH,
  passphraseEntropy,
  STRENGTH_NOTE,
  WORDLIST,
  type GeneratorOptions,
  type StrengthResult,
} from "@/core/security/password";
import type { ToolComponentProps } from "@/tools/implementations";

/** Barème d'entropie, affiché tel quel pour que le verdict soit vérifiable. */
function entropyVerdict(bits: number): { label: string; tone: "error" | "warning" | "info" | "success" } {
  if (bits < 50) return { label: "Insuffisant", tone: "error" };
  if (bits < 70) return { label: "Correct pour un usage secondaire", tone: "warning" };
  if (bits < 90) return { label: "Bon", tone: "info" };
  return { label: "Très bon", tone: "success" };
}

/**
 * Générateur de mots de passe et de phrases secrètes.
 *
 * Rien n'est conservé : ni dans les récents, ni dans le stockage local, ni
 * dans une notification. Le mot de passe existe le temps de la session et
 * disparaît en changeant d'écran.
 */
export function PasswordGenerateTool(_props: ToolComponentProps) {
  const [mode, setMode] = useState<"password" | "passphrase">("password");
  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_OPTIONS);
  const [count, setCount] = useState(5);
  const [words, setWords] = useState(5);
  const [separator, setSeparator] = useState("-");
  const [capitalize, setCapitalize] = useState(true);
  const [appendDigit, setAppendDigit] = useState(true);
  const [list, setList] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();

  const alphabetSize = alphabetFor(options).length;
  const bits =
    mode === "password"
      ? entropyBits(alphabetSize, options.length)
      : passphraseEntropy(words, appendDigit);
  const verdict = entropyVerdict(bits);

  const generate = () => {
    try {
      setError(undefined);
      setList(
        mode === "password"
          ? generatePasswords(options, count)
          : Array.from({ length: count }, () =>
              generatePassphrase({ words, separator, capitalize, appendDigit }),
            ),
      );
    } catch (failure) {
      setList([]);
      setError(failure instanceof Error ? failure.message : "Génération impossible.");
    }
  };

  // Un générateur vide au premier affichage n'aide personne.
  useEffect(generate, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-4">
      <Fieldset columns={2}>
        <Field label="Type">
          <OptionGroup
            ariaLabel="Type"
            value={mode}
            onChange={setMode}
            options={[
              { value: "password", label: "Mot de passe" },
              { value: "passphrase", label: "Phrase secrète" },
            ]}
          />
        </Field>
        <Field label="Quantité" hint={`1 à ${MAX_COUNT}`}>
          <NumberInput
            value={count}
            min={1}
            max={MAX_COUNT}
            onChange={(event) => setCount(Number(event.target.value))}
            aria-label="Quantité"
          />
        </Field>
      </Fieldset>

      {mode === "password" ? (
        <Fieldset columns={2} title="Composition">
          <Field label={`Longueur (${MIN_LENGTH} à ${MAX_LENGTH})`}>
            <NumberInput
              value={options.length}
              min={MIN_LENGTH}
              max={MAX_LENGTH}
              onChange={(event) => update("length", Number(event.target.value))}
              aria-label="Longueur"
              data-testid="password-length"
            />
          </Field>
          <Field label="Caractères">
            <div className="grid gap-1 sm:grid-cols-2">
              <CheckOption
                checked={options.lowercase}
                onChange={(value) => update("lowercase", value)}
                label="Minuscules"
              />
              <CheckOption
                checked={options.uppercase}
                onChange={(value) => update("uppercase", value)}
                label="Majuscules"
              />
              <CheckOption
                checked={options.digits}
                onChange={(value) => update("digits", value)}
                label="Chiffres"
              />
              <CheckOption
                checked={options.symbols}
                onChange={(value) => update("symbols", value)}
                label="Symboles"
              />
            </div>
          </Field>
          <Field label="Lisibilité" full>
            <CheckOption
              checked={options.excludeAmbiguous}
              onChange={(value) => update("excludeAmbiguous", value)}
              label="Écarter les caractères ambigus"
              hint="I, l, 1, O, 0 et la ponctuation qu'on confond à la lecture ou à la dictée."
            />
          </Field>
        </Fieldset>
      ) : (
        <Fieldset columns={2} title="Composition">
          <Field label="Nombre de mots" hint="3 à 12">
            <NumberInput
              value={words}
              min={3}
              max={12}
              onChange={(event) => setWords(Number(event.target.value))}
              aria-label="Nombre de mots"
            />
          </Field>
          <Field label="Séparateur">
            <TextInput
              value={separator}
              maxLength={3}
              onChange={(event) => setSeparator(event.target.value)}
              aria-label="Séparateur"
            />
          </Field>
          <Field label="Options" full>
            <div className="grid gap-1 sm:grid-cols-2">
              <CheckOption
                checked={capitalize}
                onChange={setCapitalize}
                label="Première lettre en majuscule"
              />
              <CheckOption
                checked={appendDigit}
                onChange={setAppendDigit}
                label="Ajouter un chiffre à la fin"
                hint="Beaucoup de formulaires l'exigent."
              />
            </div>
          </Field>
        </Fieldset>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="md" variant="primary" onClick={generate}>
          <Icon name="RefreshCw" size={15} /> Générer
        </Button>
        <CopyButton value={list.join("\n")} label="Tout copier" />
        <div className="flex-1" />
        <span className="ft-meta ft-num">
          {mode === "password"
            ? `${alphabetSize} caractères possibles`
            : `${WORDLIST.length} mots dans la liste`}
        </span>
      </div>

      <InputError message={error} />

      {list.length > 0 && (
        <>
          <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
            <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
              {list.length > 1 ? "Propositions" : "Proposition"}
            </h3>
            <ul className="divide-y divide-[var(--ft-rule)]">
              {list.map((value, index) => (
                <li key={`${value}-${index}`} className="ft-row-py flex items-center gap-2 px-3">
                  <span className="ft-value min-w-0 flex-1 break-all text-[13px] text-[var(--ft-text)]">
                    {value}
                  </span>
                  <CopyButton value={value} label="" />
                </li>
              ))}
            </ul>
          </section>

          <ValueTable
            caption="Solidité théorique"
            rows={[
              { label: "Entropie", value: `${bits.toFixed(1)} bits`, highlight: true },
              { label: "Verdict", value: verdict.label },
              {
                label: "Attaque hors ligne",
                hint: `${GUESSES_PER_SECOND.toExponential(0)} essais/s`,
                value: crackTime(bits),
              },
            ]}
          />
        </>
      )}

      <Callout tone="info" title="Rien n'est conservé">
        Les mots de passe sont produits sur cet appareil par le générateur cryptographique du
        système, et ne sont écrits nulle part : ni dans l'historique, ni dans les récents, ni dans
        un fichier. Fermer cet écran les fait disparaître.
      </Callout>
    </div>
  );
}

/* ==================================================================== */

const SCORE_TONE: Record<number, "error" | "warning" | "info" | "success"> = {
  0: "error",
  1: "error",
  2: "warning",
  3: "info",
  4: "success",
};

const SCORE_COLOR: Record<number, string> = {
  0: "var(--ft-danger)",
  1: "var(--ft-danger)",
  2: "var(--ft-warn)",
  3: "var(--ft-accent)",
  4: "var(--ft-ok)",
};

/**
 * Évaluation de la robustesse d'un mot de passe, entièrement locale.
 *
 * Le score vient de zxcvbn, qui cherche des motifs (mots de dictionnaires
 * français et anglais, dates, suites de touches) plutôt que de compter des
 * classes de caractères. « Tr0ub4dor&3 » a l'air complexe et ne l'est pas :
 * c'est exactement ce que cette approche sait dire.
 */
export function PasswordStrengthTool(_props: ToolComponentProps) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<StrengthResult | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    if (password.length === 0) {
      setResult(undefined);
      setError(undefined);
      return;
    }
    void evaluatePassword(password)
      .then((value) => {
        if (!cancelled) {
          setResult(value);
          setError(undefined);
        }
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setResult(undefined);
        setError(failure instanceof Error ? failure.message : "Évaluation impossible.");
      });
    return () => {
      cancelled = true;
    };
  }, [password]);

  const bars = useMemo(() => [0, 1, 2, 3, 4], []);

  return (
    <div className="space-y-4">
      <Callout tone="info" title="Évaluation locale">
        {STRENGTH_NOTE}
      </Callout>

      <Fieldset columns={1}>
        <Field label="Mot de passe à évaluer">
          <div className="flex items-center gap-2">
            <TextInput
              type={visible ? "text" : "password"}
              value={password}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setPassword(event.target.value)}
              aria-label="Mot de passe à évaluer"
              data-testid="password-input"
            />
            <Button
              size="sm"
              onClick={() => setVisible((current) => !current)}
              aria-label={visible ? "Masquer" : "Afficher"}
            >
              <Icon name={visible ? "EyeOff" : "Eye"} size={14} />
            </Button>
          </div>
        </Field>
      </Fieldset>

      <InputError message={error} />

      {result && (
        <>
          <div className="flex items-center gap-1.5" aria-hidden>
            {bars.map((index) => (
              <span
                key={index}
                className="h-1.5 flex-1 rounded-full"
                style={{
                  background:
                    index <= result.score ? SCORE_COLOR[result.score] : "var(--ft-surface-2)",
                }}
              />
            ))}
          </div>

          <ResultBlock
            value={result.label}
            formula={`Score ${result.score} sur 4 · ${result.length} caractère${result.length > 1 ? "s" : ""}`}
            secondary={[
              { label: "Essais estimés", value: result.guesses.toExponential(2) },
              {
                label: "Attaque hors ligne",
                value: result.crackTime,
              },
            ]}
          />

          {result.warnings.length > 0 && (
            <Callout tone={SCORE_TONE[result.score]} title="Points faibles">
              <ul className="list-disc space-y-0.5 pl-4">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Callout>
          )}

          {result.patterns.length > 0 && (
            <ValueTable
              caption="Motifs reconnus"
              rows={result.patterns.map((pattern, index) => ({
                label: `Segment ${index + 1}`,
                value: pattern,
              }))}
            />
          )}

          {result.suggestions.length > 0 && (
            <Callout tone="info" title="Suggestions">
              <ul className="list-disc space-y-0.5 pl-4">
                {result.suggestions.map((suggestion) => (
                  <li key={suggestion}>{suggestion}</li>
                ))}
              </ul>
            </Callout>
          )}
        </>
      )}

      {password.length === 0 && (
        <TextPane
          label="Comment lire le score"
          readOnly
          droppable={false}
          monospace={false}
          minHeight="7rem"
          value={
            "0 à 1 — devinable très vite, y compris par quelqu'un qui ne vous connaît pas.\n" +
            "2 — tient face à une attaque en ligne limitée, pas face à une fuite de base.\n" +
            "3 — correct pour un compte ordinaire.\n" +
            "4 — adapté à un compte sensible (messagerie, banque, gestionnaire de mots de passe).\n\n" +
            "Un score élevé ne dit rien de la réutilisation : un excellent mot de passe employé sur " +
            "dix sites tombe avec le premier d'entre eux."
          }
        />
      )}
    </div>
  );
}
