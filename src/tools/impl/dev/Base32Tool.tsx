import { useMemo, useState } from "react";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, OptionGroup, Select } from "@/components/pdf/Field";
import { CheckOption, TextToolShell } from "@/components/text/TextToolShell";
import {
  BASE32_ALPHABET_LABELS,
  decodeBase32Text,
  encodeBase32Text,
  wrapBase32,
  type Base32Alphabet,
} from "@/core/code/base32";
import type { ToolComponentProps } from "@/tools/implementations";

type Direction = "encode" | "decode";

/**
 * Base32, dans les deux sens.
 *
 * L'écran reste volontairement court : deux alphabets — ceux que la RFC 4648
 * définit —, un interrupteur de padding, et rien d'autre. Les dialectes maison
 * (Crockford, z-base-32) ne sont pas des variantes mais d'autres encodages :
 * les proposer ici laisserait croire qu'un décodeur RFC 4648 sait les lire.
 */
export function Base32Tool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [direction, setDirection] = useState<Direction>("encode");
  const [alphabet, setAlphabet] = useState<Base32Alphabet>("rfc4648");
  const [padding, setPadding] = useState(true);
  const [wrap, setWrap] = useState(false);

  const result = useMemo(() => {
    if (input.length === 0) return { output: "", error: undefined };
    try {
      if (direction === "encode") {
        const encoded = encodeBase32Text(input, { alphabet, padding });
        return { output: wrap ? wrapBase32(encoded, 64) : encoded, error: undefined };
      }
      return { output: decodeBase32Text(input, { alphabet }), error: undefined };
    } catch (failure) {
      return {
        output: "",
        error: failure instanceof Error ? failure.message : "Conversion impossible.",
      };
    }
  }, [input, direction, alphabet, padding, wrap]);

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      output={result.output}
      inputLabel={direction === "encode" ? "Texte" : "Base32"}
      outputLabel={direction === "encode" ? "Base32" : "Texte"}
      placeholder={
        direction === "encode" ? "Texte à encoder…" : "MZXW6YTBOI======"
      }
      downloadName={direction === "encode" ? "base32.txt" : "decode.txt"}
      error={result.error}
      sample={direction === "encode" ? "foobar" : "MZXW6YTBOI======"}
      layout="side-by-side"
      summary={
        result.output.length > 0 ? (
          <>
            {input.length} caractère{input.length > 1 ? "s" : ""} en entrée ·{" "}
            {result.output.replace(/\n/g, "").length} en sortie
            {direction === "encode" && " (le Base32 allonge d'environ 60 %)"}
          </>
        ) : undefined
      }
    >
      <Fieldset columns={2}>
        <Field label="Sens">
          <OptionGroup
            ariaLabel="Sens de conversion"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "encode", label: "Texte → Base32" },
              { value: "decode", label: "Base32 → Texte" },
            ]}
          />
        </Field>
        <Field label="Alphabet">
          <Select
            value={alphabet}
            onChange={setAlphabet}
            aria-label="Alphabet Base32"
            options={[
              { value: "rfc4648", label: BASE32_ALPHABET_LABELS.rfc4648 },
              { value: "rfc4648-hex", label: BASE32_ALPHABET_LABELS["rfc4648-hex"] },
            ]}
          />
        </Field>
      </Fieldset>

      {direction === "encode" ? (
        <div className="space-y-2">
          <CheckOption
            checked={padding}
            onChange={setPadding}
            label="Compléter avec des « = »"
            hint="Ce que la RFC impose et ce qu'attendent la plupart des décodeurs. Les secrets TOTP, eux, s'écrivent souvent sans."
          />
          <CheckOption
            checked={wrap}
            onChange={setWrap}
            label="Couper en lignes de 64 caractères"
            hint="Pour recopier une longue sortie dans un courriel ou un fichier de configuration."
          />
        </div>
      ) : (
        <Callout tone="info">
          Les espaces et les retours à la ligne sont ignorés, et les minuscules acceptées : un
          Base32 recopié depuis un terminal se décode tel quel.
        </Callout>
      )}
    </TextToolShell>
  );
}
