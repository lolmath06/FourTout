/**
 * Sécurisation du SVG.
 *
 * Un SVG est un document XML qui peut contenir des scripts, des références à
 * des ressources externes (réseau ou fichiers locaux) et des gestionnaires
 * d'évènements. Avant tout rendu, on retire ce qui pourrait exécuter du code
 * ou déclencher un accès réseau, conformément au principe local/hors-ligne.
 *
 * Le rendu se fait ensuite via un élément <img> (voir `codec.ts`), qui de
 * toute façon n'exécute jamais les scripts d'un SVG et ne charge pas ses
 * sous-ressources — cette sanitisation est une défense en profondeur.
 */

/** Retire scripts, gestionnaires d'évènements et références externes. */
export function sanitizeSvg(svg: string): string {
  let out = svg;

  // Déclarations de type de document et entités : neutralisent les attaques
  // par entités externes (XXE) et les bombes à entités.
  out = out.replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  out = out.replace(/<!ENTITY[\s\S]*?>/gi, "");

  // Blocs <script> et <foreignObject> (qui peut réintroduire du HTML actif).
  out = out.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
  out = out.replace(/<script[^>]*\/>/gi, "");
  out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "");

  // Attributs de gestion d'évènements : on...="".
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");

  // Références externes : href / xlink:href pointant ailleurs que vers un
  // fragment interne (#id) ou une donnée en ligne (data:image/*).
  out = out.replace(/((?:xlink:)?href)\s*=\s*"([^"]*)"/gi, (match, attr, value) =>
    isSafeReference(value) ? match : `${attr}="#"`,
  );
  out = out.replace(/((?:xlink:)?href)\s*=\s*'([^']*)'/gi, (match, attr, value) =>
    isSafeReference(value) ? match : `${attr}='#'`,
  );

  // url(...) réseau dans les attributs de style/présentation.
  out = out.replace(/url\(\s*['"]?\s*(https?:|file:|\/\/)[^)]*\)/gi, "none");

  return out;
}

function isSafeReference(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith("#") || v.startsWith("data:image/");
}

/**
 * Taille intrinsèque d'un SVG. On lit `width`/`height`, sinon le `viewBox`, et
 * on retombe sur 512×512 pour un document sans dimension déclarée.
 */
export function svgIntrinsicSize(svg: string): { width: number; height: number } {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const width = numericAttr(tag, "width");
  const height = numericAttr(tag, "height");
  if (width && height) return { width, height };

  const viewBox = /viewBox\s*=\s*["']?\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  if (viewBox) {
    const vbWidth = Number(viewBox[3]);
    const vbHeight = Number(viewBox[4]);
    if (vbWidth > 0 && vbHeight > 0) {
      if (width) return { width, height: Math.round((width / vbWidth) * vbHeight) };
      if (height) return { width: Math.round((height / vbHeight) * vbWidth), height };
      return { width: Math.round(vbWidth), height: Math.round(vbHeight) };
    }
  }
  return { width: width || 512, height: height || 512 };
}

function numericAttr(tag: string, name: string): number {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']?\\s*([\\d.]+)`, "i").exec(tag);
  return match ? Math.round(Number(match[1])) : 0;
}
