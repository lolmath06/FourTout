import { cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { parseMessage, resolveMessage, type MessageValues, type ResolvedPart } from "./format";
import { currentIntlLocale, translateRaw } from "./runtime";

interface TransProps {
  /** Texte source, balises numérotées comprises : « Débit <0>moyen</0>. » */
  source: string;
  /** Valeurs des arguments `{nom}` ; elles peuvent être des éléments React. */
  values?: MessageValues;
  /** Éléments des balises `<0>`, `<1>`… ; leur contenu vient du message. */
  components?: ReactElement[];
}

/**
 * Message traduit avec du balisage.
 *
 * Une phrase coupée par un `<strong>` reste un seul message pour le
 * traducteur, qui peut déplacer la balise là où sa langue la veut.
 */
export function Trans({ source, values, components = [] }: TransProps) {
  const parts = resolveMessage(parseMessage(translateRaw(source)), values, currentIntlLocale());
  return <>{render(parts, components)}</>;
}

function render(parts: ResolvedPart[], components: ReactElement[]): ReactNode[] {
  return parts.map((part, index) => {
    if (typeof part === "string") return part;
    if ("value" in part) {
      const value = part.value;
      if (value === null || value === undefined || typeof value === "boolean") return null;
      if (isValidElement(value)) return <Fragment key={index}>{value}</Fragment>;
      if (Array.isArray(value)) return <Fragment key={index}>{value as ReactNode[]}</Fragment>;
      return String(value);
    }
    const element = components[part.tag];
    const children = part.children ? render(part.children, components) : undefined;
    if (!element) return <Fragment key={index}>{children}</Fragment>;
    return children === undefined
      ? cloneElement(element, { key: index })
      : cloneElement(element, { key: index }, ...children);
  });
}
