import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import {Contacts, CopyButton, NativeGate, UrlField } from "@/components/internet/parts";
import { errorMessage } from "@/core/internet/errors";
import { shortenUrl, type ShortenProvider, type Shortened } from "@/core/internet/native";
import { looksLikeWebUrl } from "@/core/internet/format";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t } from "@/i18n";

const PROVIDERS = localized(() => [
  { value: "is-gd" as ShortenProvider, label: "is.gd", hint: t("Service gratuit, sans compte.") },
  { value: "v-gd" as ShortenProvider, label: "v.gd", hint: t("Même exploitant ; une page d'aperçu s'affiche avant la redirection.") },
  { value: "tiny-url" as ShortenProvider, label: "TinyURL", hint: t("Service gratuit, sans compte.") },
]);

/**
 * Raccourcir une adresse auprès d'un service public.
 *
 * FourTout n'a pas de serveur de redirection : l'adresse est envoyée au
 * service choisi, qui la conserve. C'est écrit en tête, et les adresses qui
 * n'existent que sur le réseau local sont refusées avant tout envoi.
 */
export function UrlShortenTool(_props: ToolComponentProps) {
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState<ShortenProvider>("is-gd");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Shortened | null>(null);
  const [error, setError] = useState<string | undefined>();

  const run = async () => {
    setBusy(true);
    setError(undefined);
    setResult(null);
    try {
      setResult(await shortenUrl(url, provider));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const label = PROVIDERS.find((p) => p.value === provider)?.label ?? "";

  return (
    <NativeGate>
      <div className="space-y-4">
        <Contacts>
          {t("L'adresse d'origine est envoyée au service choisi ({provider}), qui la conserve. Ne raccourcissez rien de confidentiel. FourTout n'ajoute aucun suivi.", { provider: label })}
        </Contacts>

        <UrlField label={t("Adresse à raccourcir")} value={url} onChange={setUrl} onSubmit={run} disabled={busy} />
        <Fieldset columns={1}>
          <Field label={t("Service")}>
            <OptionGroup value={provider} onChange={setProvider} options={PROVIDERS} ariaLabel={t("Service de raccourcissement")} disabled={busy} />
          </Field>
        </Fieldset>
        <div className="flex justify-end border-t border-[var(--ft-rule)] pt-3">
          <Button size="md" variant="primary" onClick={run} disabled={!looksLikeWebUrl(url) || busy}>
            {busy ? <Icon name="Loader" size={15} className="animate-spin" /> : <Icon name="Link2" size={15} />} {t("Raccourcir")}
          </Button>
        </div>

        {error && <Callout tone="error" title={t("Raccourcissement impossible")}>{error}</Callout>}

        {result && (
          <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] p-3" data-testid="shorten-result">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 break-all font-mono text-base font-medium" data-testid="short-url">{result.shortUrl}</span>
              <CopyButton text={result.shortUrl} size="md" />
            </div>
            <dl className="ft-meta grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt>{t("Service")}</dt>
              <dd>{result.provider} <span className="text-[var(--ft-text-faint)]">({result.endpoint})</span></dd>
              <dt>{t("Adresse d'origine")}</dt>
              <dd className="break-all font-mono">{result.original}</dd>
            </dl>
            <p className="ft-meta">{t("Le lien n'est pas ouvert automatiquement : copiez-le, puis utilisez-le où vous voulez.")}</p>
          </div>
        )}
      </div>
    </NativeGate>
  );
}
