import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, NumberInput, OptionGroup, Select, TextInput } from "@/components/pdf/Field";
import { CheckOption, TextPane } from "@/components/text/TextToolShell";
import { CopyButton, InputError, ResultBlock, ValueTable } from "@/components/calc/CalcShell";
import {
  baseViews,
  describeTimestamp,
  formatInBase,
  generateUuids,
  groupDigits,
  guessTimestampUnit,
  JWT_SIGNATURE_NOTE,
  MAX_BASE,
  MAX_UUID_COUNT,
  MIN_BASE,
  decodeJwt,
  parseInBase,
  type TimestampUnit,
  type UuidVersion,
} from "@/core/code/tokens";
import { formatJson } from "@/core/code/data";
import { PasswordField } from "@/components/files/PasswordField";
import {
  isSupportedAlgorithm,
  JWT_ALGORITHM_LABELS,
  keyKindFor,
  SUPPORTED_JWT_ALGORITHMS,
  verdictSentence,
  verifyJwt,
  type JwtAlgorithm,
  type JwtVerification,
} from "@/core/code/jwtVerify";
import { isJwtVerifyAvailable, nativeSignatureChecker } from "@/core/code/jwtNative";
import { notify } from "@/features/notifications/store";
import { saveFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, localized, t, tx } from "@/i18n";

/* ==================================================================== */
/* JWT                                                                   */
/* ==================================================================== */

/**
 * Décodeur de JWT.
 *
 * L'avertissement « décodé n'est pas vérifié » est affiché en permanence, en
 * haut de l'écran : c'est le point sur lequel un outil de ce genre peut faire
 * le plus de dégâts s'il laisse planer un doute.
 */
export function JwtDecodeTool(_props: ToolComponentProps) {
  const [token, setToken] = useState("");

  const decoded = useMemo(() => {
    if (token.trim().length === 0) return undefined;
    try {
      return { value: decodeJwt(token), error: undefined };
    } catch (failure) {
      return {
        value: undefined,
        error: failure instanceof Error ? failure.message : t("Token illisible."),
      };
    }
  }, [token]);

  return (
    <div className="space-y-4">
      <Callout tone="warning" title={t("Décodé n'est pas vérifié")}>
        {JWT_SIGNATURE_NOTE}
      </Callout>

      <TextPane
        label={t("Token JWT")}
        value={token}
        onChange={setToken}
        placeholder={t("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…")}
        minHeight="7rem"
      />

      <InputError message={tx(decoded?.error)} />

      {decoded?.value && (
        <>
          {decoded.value.warnings.map((warning) => (
            <Callout key={warning} tone="warning">
              {tx(warning)}
            </Callout>
          ))}

          <ValueTable
            caption={t("En-tête")}
            rows={Object.entries(decoded.value.header).map(([key, value]) => ({
              label: key,
              value: String(value),
              highlight: key === "alg",
            }))}
          />

          <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
            <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
              {t("Claims de la charge utile")}
            </h3>
            <ul className="divide-y divide-[var(--ft-rule)]">
              {decoded.value.claims.map((claim) => (
                <li key={claim.name} className="ft-row-py px-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="ft-value font-medium text-[var(--ft-text)]">{claim.name}</span>
                    <span
                      className={`ft-value min-w-0 flex-1 break-all ${
                        claim.expired ? "text-[var(--ft-danger)]" : "text-[var(--ft-text-muted)]"
                      }`}
                    >
                      {typeof claim.raw === "object" ? JSON.stringify(claim.raw) : String(claim.raw)}
                    </span>
                  </div>
                  <p className="ft-meta">
                    {tx(claim.description)}
                    {claim.readable && ` · ${claim.readable}`}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <div className="flex flex-col gap-3 lg:flex-row">
            <TextPane
              label={t("En-tête (JSON)")}
              value={formatJson(JSON.stringify(decoded.value.header))}
              readOnly
              droppable={false}
              minHeight="8rem"
            />
            <TextPane
              label={t("Charge utile (JSON)")}
              value={formatJson(JSON.stringify(decoded.value.payload))}
              readOnly
              droppable={false}
              minHeight="8rem"
            />
          </div>

          <ValueTable
            caption={t("Signature")}
            rows={[
              { label: t("Algorithme annoncé"), value: decoded.value.algorithm },
              { label: t("Signature (base64url)"), value: decoded.value.signature },
            ]}
          />

          <JwtVerificationPanel token={token} headerAlgorithm={decoded.value.algorithm} />
        </>
      )}
    </div>
  );
}

/**
 * Vérification de la signature, dans le même écran que le décodage.
 *
 * Deux principes gouvernent cette section, et ils se voient :
 *
 * 1. **L'algorithme est choisi par vous, pas par le token.** Le sélecteur se
 *    pré-remplit avec ce qu'annonce l'en-tête, par commodité, mais c'est bien
 *    votre choix qui sert au calcul — et toute divergence est un refus, pas un
 *    ajustement silencieux. C'est ce que visent les attaques « alg: none » et
 *    « RS256 dégradé en HS256 ».
 * 2. **Signature et claims sont deux verdicts distincts.** Un token peut être
 *    authentique et pourtant expiré ; l'écran affiche les deux séparément,
 *    parce que les confondre revient soit à accepter un token périmé, soit à
 *    crier à la falsification sans raison.
 *
 * Le secret n'est ni enregistré, ni journalisé, ni transmis aux récents : il
 * vit dans cet état de composant et disparaît avec lui.
 */
function JwtVerificationPanel({
  token,
  headerAlgorithm,
}: {
  token: string;
  headerAlgorithm: string;
}) {
  const [algorithm, setAlgorithm] = useState<JwtAlgorithm>("HS256");
  const [secret, setSecret] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [result, setResult] = useState<JwtVerification | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // L'en-tête pré-remplit le sélecteur, sans jamais décider à votre place :
  // c'est la valeur affichée qui servira, et vous pouvez la changer.
  useEffect(() => {
    if (isSupportedAlgorithm(headerAlgorithm)) setAlgorithm(headerAlgorithm);
  }, [headerAlgorithm]);

  // Un changement de token ou de réglage périme le verdict précédent : laisser
  // « SIGNATURE VALIDE » affiché sous un autre token serait le pire des bugs.
  useEffect(() => {
    setResult(undefined);
    setError(undefined);
  }, [token, algorithm, secret, publicKey]);

  const kind = keyKindFor(algorithm);
  const key = kind === "secret" ? secret : publicKey;
  const available = isJwtVerifyAvailable();

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setResult(await verifyJwt(token, { algorithm, key }, nativeSignatureChecker));
    } catch (failure) {
      setResult(undefined);
      setError(failure instanceof Error ? failure.message : t("Vérification impossible."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-3">
      <h3 className="ft-section">{t("Vérifier la signature")}</h3>

      <Fieldset columns={1}>
        <Field
          label={t("Algorithme attendu")}
          hint={t("C'est votre choix qui sert au calcul. Si l'en-tête du token annonce autre chose, la vérification est refusée.")}
        >
          <Select
            value={algorithm}
            onChange={setAlgorithm}
            aria-label={t("Algorithme attendu")}
            options={SUPPORTED_JWT_ALGORITHMS.map((value) => ({
              value,
              label: JWT_ALGORITHM_LABELS[value],
            }))}
          />
        </Field>
      </Fieldset>

      {kind === "secret" ? (
        <Fieldset columns={1}>
          <PasswordField
            value={secret}
            onChange={setSecret}
            label={t("Secret partagé")}
            hint={t("Masqué par défaut, jamais enregistré ni ajouté aux récents.")}
          />
        </Fieldset>
      ) : (
        <>
          <TextPane
            label={t("Clé publique (PEM)")}
            value={publicKey}
            onChange={setPublicKey}
            placeholder={"-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----"}
            minHeight="7rem"
            droppable={false}
          />
          <p className="ft-meta">
            <Trans source={"La clé <0>publique</0> suffit : vérifier une signature ne demande jamais la clé privée, et aucun outil ne devrait vous la réclamer."} components={[<strong />]} />
          </p>
        </>
      )}

      {!available && (
        <Callout tone="info">
          {t("La vérification utilise le moteur cryptographique de FourTout et nécessite l'application installée. Le décodage ci-dessus, lui, fonctionne partout.")}
        </Callout>
      )}

      <Button
        variant="primary"
        onClick={run}
        disabled={!available || busy || token.trim().length === 0 || key.length === 0}
      >
        <Icon name="ShieldCheck" size={14} /> {busy ? t("Vérification…") : t("Vérifier")}
      </Button>

      {error && <Callout tone="error">{tx(error)}</Callout>}

      {result && (
        <div className="space-y-2">
          {result.signature === "refused" ? (
            <Callout tone="error" title="VÉRIFICATION REFUSÉE">
              {result.refusal}
            </Callout>
          ) : result.signature === "valid" ? (
            <Callout tone="success" title="SIGNATURE VALIDE">
              {t("Le calcul a été refait avec la clé fournie et il concorde : ce token a bien été produit par le détenteur de cette clé, et son contenu n'a pas été modifié depuis.")}
            </Callout>
          ) : (
            <Callout tone="error" title="SIGNATURE INVALIDE">
              {t("Le calcul ne concorde pas : soit la clé n'est pas la bonne, soit le token a été modifié après signature.")}
            </Callout>
          )}

          {result.signature === "valid" && result.claims.expired && (
            <Callout tone="warning" title="EXPIRÉ">
              {t("La signature est authentique, mais la date d'expiration est dépassée. Ce sont deux choses différentes : le token est vrai, et inutilisable.")}
            </Callout>
          )}

          {result.signature === "valid" && result.claims.notYetValid && (
            <Callout tone="warning" title="PAS ENCORE VALIDE">
              <Trans source={"La signature est authentique, mais le claim <0>nbf</0> place le début de validité dans le futur."} components={[<code />]} />
            </Callout>
          )}

          <ValueTable
            caption={t("Ce qui a été vérifié")}
            rows={[
              { label: t("Algorithme annoncé par le token"), value: result.headerAlgorithm },
              { label: t("Algorithme utilisé pour vérifier"), value: result.expectedAlgorithm },
              { label: t("Verdict"), value: verdictSentence(result), highlight: true },
            ]}
          />
        </div>
      )}
    </section>
  );
}

/* ==================================================================== */
/* UUID                                                                  */
/* ==================================================================== */

/** Générateur d'UUID v4 et v7, alimenté par le générateur cryptographique. */
export function UuidTool(_props: ToolComponentProps) {
  const [version, setVersion] = useState<UuidVersion>("v4");
  const [count, setCount] = useState(10);
  const [uppercase, setUppercase] = useState(false);
  const [braces, setBraces] = useState(false);
  const [list, setList] = useState<string[]>(() => generateUuids("v4", 10));

  const decorate = (value: string) => {
    const cased = uppercase ? value.toUpperCase() : value;
    return braces ? `{${cased}}` : cased;
  };
  const text = list.map(decorate).join("\n");

  const regenerate = () => setList(generateUuids(version, count));

  const download = async () => {
    const saved = await saveFile({
      name: t("uuid-{version}.txt", { version }),
      bytes: new TextEncoder().encode(`${text}\n`),
      mimeType: "text/plain",
    });
    if (saved.saved) notify.success(t("Liste enregistrée"), saved.path);
  };

  return (
    <div className="space-y-4">
      <Fieldset columns={3}>
        <Field
          label={t("Version")}
          hint={
            version === "v4"
              ? t("122 bits d'aléa : aucune information n'y est encodée.")
              : t("Horodatage en tête : les identifiants se trient chronologiquement.")
          }
        >
          <OptionGroup
            ariaLabel={t("Version")}
            value={version}
            onChange={setVersion}
            options={[
              { value: "v4", label: t("v4 (aléatoire)") },
              { value: "v7", label: t("v7 (horodaté)") },
            ]}
          />
        </Field>
        <Field label={t("Quantité")} hint={`1 à ${MAX_UUID_COUNT}`}>
          <NumberInput
            value={count}
            min={1}
            max={MAX_UUID_COUNT}
            onChange={(event) => setCount(Number(event.target.value))}
            aria-label={t("Quantité")}
          />
        </Field>
        <Field label={t("Mise en forme")}>
          <div className="space-y-1">
            <CheckOption checked={uppercase} onChange={setUppercase} label={t("Majuscules")} />
            <CheckOption checked={braces} onChange={setBraces} label={t("Entre accolades")} />
          </div>
        </Field>
      </Fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="md" variant="primary" onClick={regenerate}>
          <Icon name="RefreshCw" size={15} />{" "}{t("Générer")}
        </Button>
        <CopyButton value={text} label={t("Tout copier")} />
        <Button size="sm" onClick={() => void download()} disabled={list.length === 0}>
          <Icon name="Download" size={13} />{" "}{t("Enregistrer en .txt")}
        </Button>
        <div className="flex-1" />
        <span className="ft-meta ft-num">{list.length} identifiants</span>
      </div>

      <TextPane label={t("Identifiants")} value={text} readOnly droppable={false} minHeight="14rem" />

      <Callout tone="info" title={t("Source d'aléa")}>
        <Trans source={"Les identifiants viennent du générateur cryptographique du système (<0>crypto.getRandomValues</0>). FourTout refuse de produire un identifiant si ce générateur est indisponible, plutôt que de retomber sur un tirage prévisible."} components={[<span className="ft-value" />]} />
      </Callout>
    </div>
  );
}

/* ==================================================================== */
/* Timestamp                                                             */
/* ==================================================================== */

/** Timestamp Unix : dans les deux sens, en secondes comme en millisecondes. */
export function TimestampTool(_props: ToolComponentProps) {
  const [direction, setDirection] = useState<"to-date" | "to-timestamp">("to-date");
  const [raw, setRaw] = useState(() => String(Math.floor(Date.now() / 1000)));
  const [unit, setUnit] = useState<TimestampUnit>("s");
  const [dateInput, setDateInput] = useState(() => new Date().toISOString().slice(0, 19));
  const [now, setNow] = useState(() => new Date());

  // L'affichage relatif (« il y a 3 minutes ») doit vieillir tout seul.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const numeric = Number(raw.trim());
  const view =
    direction === "to-date" && raw.trim().length > 0 && Number.isFinite(numeric)
      ? (() => {
          try {
            return { value: describeTimestamp(numeric, unit, now), error: undefined };
          } catch (failure) {
            return {
              value: undefined,
              error: failure instanceof Error ? failure.message : t("Date impossible."),
            };
          }
        })()
      : undefined;

  const parsedDate = direction === "to-timestamp" ? new Date(dateInput) : undefined;
  const dateValid = parsedDate !== undefined && !Number.isNaN(parsedDate.getTime());

  return (
    <div className="space-y-4">
      <Fieldset columns={2}>
        <Field label={t("Sens")}>
          <OptionGroup
            ariaLabel={t("Sens de conversion")}
            value={direction}
            onChange={setDirection}
            options={[
              { value: "to-date", label: t("Timestamp → date") },
              { value: "to-timestamp", label: t("Date → timestamp") },
            ]}
          />
        </Field>
        {direction === "to-date" ? (
          <Field label={t("Unité")} hint={t("Détectée : {value}", { value: guessTimestampUnit(numeric) === "s" ? "secondes" : "millisecondes" })}>
            <OptionGroup
              ariaLabel={t("Unité")}
              value={unit}
              onChange={setUnit}
              options={[
                { value: "s", label: t("Secondes") },
                { value: "ms", label: t("Millisecondes") },
              ]}
            />
          </Field>
        ) : (
          <Field label={t("Date et heure locales")}>
            <TextInput
              type="datetime-local"
              step={1}
              value={dateInput}
              onChange={(event) => setDateInput(event.target.value)}
              aria-label={t("Date et heure")}
            />
          </Field>
        )}
      </Fieldset>

      {direction === "to-date" && (
        <Fieldset columns={1}>
          <Field label={t("Timestamp")}>
            <TextInput
              value={raw}
              inputMode="numeric"
              autoFocus
              onChange={(event) => {
                setRaw(event.target.value);
                const next = Number(event.target.value.trim());
                if (Number.isFinite(next) && next !== 0) setUnit(guessTimestampUnit(next));
              }}
              aria-label={t("Timestamp")}
              data-testid="timestamp-input"
              className="font-mono"
            />
          </Field>
        </Fieldset>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            const current = new Date();
            setNow(current);
            if (direction === "to-date") {
              setRaw(String(unit === "s" ? Math.floor(current.getTime() / 1000) : current.getTime()));
            } else {
              setDateInput(
                new Date(current.getTime() - current.getTimezoneOffset() * 60_000)
                  .toISOString()
                  .slice(0, 19),
              );
            }
          }}
        >
          <Icon name="Clock3" size={13} />{" "}{t("Maintenant")}
        </Button>
      </div>

      <InputError
        message={
          direction === "to-date"
            ? raw.trim().length > 0 && !Number.isFinite(numeric)
              ? t("Le timestamp doit être un nombre.")
              : view?.error
            : dateInput.length > 0 && !dateValid
              ? t("Date invalide.")
              : undefined
        }
      />

      {direction === "to-date" && view?.value && (
        <>
          <ResultBlock value={view.value.local} formula={view.value.relative} />
          <ValueTable
            caption={t("Autres formats")}
            rows={[
              { label: "ISO 8601 (UTC)", value: view.value.iso },
              { label: "UTC", value: view.value.utc },
              { label: t("Secondes"), value: String(Math.floor(view.value.date.getTime() / 1000)) },
              { label: t("Millisecondes"), value: String(view.value.date.getTime()) },
            ]}
          />
        </>
      )}

      {direction === "to-timestamp" && dateValid && parsedDate && (
        <>
          <ResultBlock
            value={String(Math.floor(parsedDate.getTime() / 1000))}
            unit="secondes"
            formula={parsedDate.toISOString()}
            secondary={[
              { label: t("Millisecondes"), value: String(parsedDate.getTime()) },
              { label: "UTC", value: parsedDate.toUTCString() },
            ]}
          />
        </>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Bases numériques                                                      */
/* ==================================================================== */

const COMMON_BASES = localized(() => [
  { value: "2", label: t("Binaire (2)") },
  { value: "8", label: t("Octal (8)") },
  { value: "10", label: t("Décimal (10)") },
  { value: "16", label: t("Hexadécimal (16)") },
]);

/**
 * Conversion entre bases numériques, **en `BigInt`**.
 *
 * `parseInt` perd les chiffres au-delà de 2^53 sans prévenir : un convertisseur
 * qui abîme le nombre confié ne sert à rien. Tout passe donc par `BigInt`.
 */
export function NumberBaseTool(_props: ToolComponentProps) {
  const [raw, setRaw] = useState("255");
  const [base, setBase] = useState("10");
  const [customBase, setCustomBase] = useState(36);
  const [useCustom, setUseCustom] = useState(false);

  const activeBase = useCustom ? customBase : Number(base);

  const parsed = useMemo(() => {
    if (raw.trim().length === 0) return undefined;
    try {
      return { value: parseInBase(raw, activeBase), error: undefined };
    } catch (failure) {
      return {
        value: undefined,
        error: failure instanceof Error ? failure.message : t("Conversion impossible."),
      };
    }
  }, [raw, activeBase]);

  const views = parsed?.value !== undefined ? baseViews(parsed.value) : undefined;

  return (
    <div className="space-y-4">
      <Fieldset columns={3}>
        <Field label={t("Nombre")} hint={t("Les préfixes 0x, 0b et les _ sont acceptés.")}>
          <TextInput
            value={raw}
            autoFocus
            spellCheck={false}
            onChange={(event) => setRaw(event.target.value)}
            aria-label={t("Nombre à convertir")}
            data-testid="base-input"
            className="font-mono"
          />
        </Field>
        <Field label={t("Base de départ")}>
          <Select
            value={base}
            onChange={(value) => {
              setBase(value);
              setUseCustom(false);
            }}
            aria-label={t("Base de départ")}
            options={COMMON_BASES}
            disabled={useCustom}
          />
        </Field>
        <Field label={t("Base personnalisée ({MIN_BASE} à {MAX_BASE})", { MIN_BASE, MAX_BASE })}>
          <div className="flex items-center gap-2">
            <CheckOption checked={useCustom} onChange={setUseCustom} label={t("Utiliser")} />
            <NumberInput
              value={customBase}
              min={MIN_BASE}
              max={MAX_BASE}
              disabled={!useCustom}
              onChange={(event) => setCustomBase(Number(event.target.value))}
              aria-label={t("Base personnalisée")}
            />
          </div>
        </Field>
      </Fieldset>

      <InputError message={tx(parsed?.error)} />

      {views && parsed?.value !== undefined && (
        <>
          <ResultBlock
            value={views.decimal}
            unit={t("décimal")}
            formula={`${raw} en base ${activeBase} · ${views.bits} bit${views.bits > 1 ? "s" : ""}`}
          />
          <ValueTable
            caption={t("Toutes les bases")}
            rows={[
              { label: t("Binaire (2)"), value: groupDigits(views.binary, 4) },
              { label: t("Octal (8)"), value: views.octal },
              { label: t("Décimal (10)"), value: views.decimal },
              { label: t("Hexadécimal (16)"), value: views.hexadecimal },
              ...(useCustom && ![2, 8, 10, 16].includes(activeBase)
                ? [
                    {
                      label: t("Base {activeBase}", { activeBase }),
                      value: formatInBase(parsed.value, activeBase),
                      highlight: true,
                    },
                  ]
                : []),
            ]}
          />
          <Callout tone="info" title={t("Précision exacte")}>
            <Trans source={"Les conversions passent par des entiers de précision arbitraire : un nombre comme<0> 9007199254740993123456789 </0>fait l'aller-retour sans perdre un seul chiffre."} components={[<span className="ft-value" />]} />
          </Callout>
        </>
      )}
    </div>
  );
}
