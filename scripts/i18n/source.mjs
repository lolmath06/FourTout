/**
 * Catalogue source complet : messages du code TypeScript et gabarits des
 * messages du socle natif (Rust), affichés tels quels par l'interface.
 */
import { collectMessages, isShellMessage, messageId, sourceCatalog } from "./messages.mjs";
import { collectNativeTemplates } from "./native.mjs";

export function buildSourceCatalog(root) {
  const { messages, dynamic } = collectMessages(root);
  const native = collectNativeTemplates(root);
  for (const template of native) {
    const list = messages.get(template) ?? [];
    if (!list.includes("src-tauri")) list.push("src-tauri");
    messages.set(template, list);
  }

  // Deux textes ne doivent jamais partager une empreinte.
  const seen = new Map();
  const collisions = [];
  for (const source of messages.keys()) {
    const id = messageId(source);
    if (seen.has(id) && seen.get(id) !== source) collisions.push([id, seen.get(id), source]);
    seen.set(id, source);
  }

  const shell = [...messages]
    .filter(([, files]) => isShellMessage(files))
    .map(([source]) => messageId(source))
    .sort();
  return { catalog: sourceCatalog(messages), native, shell, dynamic, collisions };
}
