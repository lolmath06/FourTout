/**
 * Recensement des messages de l'interface.
 *
 * Un message est un texte source passé à `t()`, `msg()` ou `<Trans source>`,
 * importés de `@/i18n`. Le recensement lit le code avec le compilateur
 * TypeScript : il ne dépend ni d'expressions régulières sur le texte, ni d'une
 * convention de nommage.
 *
 * Utilisé par `extract.mjs` (qui écrit `src/i18n/messages/fr.json`) et par les
 * tests de couverture des traductions.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/** Même empreinte que `messageId` dans `src/i18n/format.ts`. */
export function messageId(source) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Tous les messages du code, avec leurs emplacements.
 * @returns {{ messages: Map<string, string[]>, dynamic: string[] }}
 *   `messages` : texte source → fichiers ; `dynamic` : appels dont le texte
 *   n'est pas littéral (à surveiller).
 */
export function collectMessages(root) {
  const messages = new Map();
  const dynamic = [];
  for (const file of sourceFiles(join(root, "src"))) {
    if (file.includes(`${join("src", "i18n")}/`)) continue;
    const text = readFileSync(file, "utf8");
    if (!text.includes("@/i18n")) continue;
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const local = new Map();
    for (const statement of sf.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "@/i18n" &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        for (const element of statement.importClause.namedBindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (["t", "msg", "Trans"].includes(imported)) local.set(element.name.text, imported);
        }
      }
    }
    if (local.size === 0) continue;
    const where = relative(root, file);
    const add = (source) => {
      const list = messages.get(source) ?? [];
      if (!list.includes(where)) list.push(where);
      messages.set(source, list);
    };
    const literal = (node) =>
      node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        ? node.text
        : undefined;
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const kind = local.get(node.expression.text);
        if (kind === "t" || kind === "msg") {
          const source = literal(node.arguments[0]);
          if (source !== undefined) add(source);
          else {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
            dynamic.push(`${where}:${line + 1}`);
          }
        }
      }
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        local.get(node.tagName.getText()) === "Trans"
      ) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== "source") continue;
          const init = attribute.initializer;
          const source =
            init && ts.isStringLiteral(init)
              ? init.text
              : init && ts.isJsxExpression(init)
                ? literal(init.expression)
                : undefined;
          if (source !== undefined) add(source);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { messages, dynamic };
}

/** Catalogue source : identifiant → texte, trié par texte pour la relecture. */
export function sourceCatalog(messages) {
  const entries = [...messages.keys()]
    .sort((a, b) => a.localeCompare(b, "fr"))
    .map((source) => [messageId(source), source]);
  return Object.fromEntries(entries);
}

/**
 * Socle de l'interface : messages employés hors des outils eux-mêmes
 * (navigation, accueil, recherche, paramètres, composants partagés). Ce sont
 * les messages **requis** dans toutes les langues ; ceux d'un outil se
 * replient sur l'anglais tant qu'ils ne sont pas traduits.
 */
export function isShellMessage(files) {
  return files.some((file) => !/^src\/(tools\/impl\/|core\/(?!tools\/))/.test(file) && file !== "src-tauri");
}
