import type { OutputFile } from "@/core/pdf/types";
import type { OperationOutcome } from "./ResultPanel";

/** Raccourci : emballe un fichier unique en résultat d'opération. */
export function singleResult(file: OutputFile, summary?: string): OperationOutcome {
  return { files: [file], summary };
}
