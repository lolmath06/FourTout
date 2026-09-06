import { dump, load, CORE_SCHEMA } from "js-yaml";
import { DataError, indentUnit, parseJson, sortJsonKeys, type Indentation } from "./data";

/**
 * YAML : formatage et conversion depuis ou vers JSON.
 *
 * Le schéma est explicitement le **schéma core de YAML 1.2** : il ne connaît
 * que des chaînes, des nombres, des booléens, des nuls, des listes et des
 * dictionnaires. Aucun tag capable d'instancier un objet ou d'exécuter du code
 * n'est accepté — un formateur de configuration ne doit jamais devenir un
 * interpréteur.
 */

const SCHEMA = CORE_SCHEMA;

/** Nombre de lignes ou de colonnes signalées par le message d'erreur. */
function toDataError(error: unknown, fallback: string): DataError {
  if (error instanceof Error) {
    const match = /\((\d+):(\d+)\)/.exec(error.message);
    const line = match ? Number(match[1]) : undefined;
    const column = match ? Number(match[2]) : undefined;
    return new DataError(error.message.split("\n")[0] || fallback, line, column);
  }
  return new DataError(fallback);
}

export function parseYaml(source: string): unknown {
  if (source.trim().length === 0) throw new DataError("Le document est vide.");
  try {
    return load(source, { schema: SCHEMA });
  } catch (error) {
    throw toDataError(error, "YAML invalide.");
  }
}

export interface YamlFormatOptions {
  indentation?: Indentation;
  sortKeys?: boolean;
}

function dumpYaml(value: unknown, options: YamlFormatOptions): string {
  // Le YAML n'admet pas la tabulation comme indentation : c'est une erreur de
  // syntaxe, pas un style. On retombe donc sur deux espaces plutôt que de
  // produire un document invalide.
  const unit = indentUnit(options.indentation ?? "2");
  const indent = unit === "\t" ? 2 : unit.length;
  try {
    return dump(options.sortKeys ? sortJsonKeys(value) : value, {
      schema: SCHEMA,
      indent,
      lineWidth: 100,
      noRefs: true,
    });
  } catch (error) {
    throw toDataError(error, "Ce document ne peut pas être écrit en YAML.");
  }
}

export function formatYaml(source: string, options: YamlFormatOptions = {}): string {
  return dumpYaml(parseYaml(source), options);
}

export function yamlToJson(source: string, options: YamlFormatOptions = {}): string {
  const value = parseYaml(source);
  const unit = indentUnit(options.indentation ?? "2");
  return JSON.stringify(options.sortKeys ? sortJsonKeys(value) : value, null, unit);
}

export function jsonToYaml(source: string, options: YamlFormatOptions = {}): string {
  return dumpYaml(parseJson(source), options);
}

/** L'indentation par tabulation est refusée par la spécification YAML. */
export const YAML_TAB_NOTE =
  "Le YAML interdit la tabulation comme indentation : deux espaces sont utilisés à la place.";
