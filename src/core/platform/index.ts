/**
 * Informations d'environnement.
 *
 * FourTout doit fonctionner à l'identique dans un navigateur (développement,
 * tests) et dans la WebView Tauri (production). Les composants n'appellent
 * jamais l'API Tauri directement : ils passent par ce module.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type PlatformName = "windows" | "linux" | "macos" | "web";

export function detectPlatform(): PlatformName {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "web";
}
