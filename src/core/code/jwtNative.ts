/**
 * Pont entre la politique de vérification JWT et la cryptographie native.
 *
 * La séparation est volontaire : `jwtVerify.ts` décide **ce qu'on accepte de
 * vérifier** (jamais `alg: none`, jamais un algorithme différent de celui
 * attendu), ce module se contente de faire refaire le calcul par le moteur
 * natif. Chacun se teste sans l'autre.
 *
 * Le calcul est fait en Rust plutôt que par `crypto.subtle` pour une raison
 * simple : `crypto.subtle` n'est disponible que dans un contexte sécurisé, ce
 * qu'une WebView servie par un protocole personnalisé n'est pas garantie
 * d'être. Une vérification de signature ne peut pas dépendre de cela.
 *
 * Le secret ou la clé traverse le pont IPC pour le calcul, puis disparaît :
 * il n'est ni journalisé, ni enregistré, ni ajouté aux récents.
 */

import { isTauri } from "@/core/platform";
import type { SignatureChecker } from "./jwtVerify";

export const JWT_VERIFY_NATIVE_REQUIRED =
  "La vérification de signature utilise le moteur cryptographique de FourTout : elle nécessite " +
  "l'application installée. Le décodage, lui, fonctionne partout.";

/** Vérificateur réel : il appelle le moteur natif. */
export const nativeSignatureChecker: SignatureChecker = async ({
  algorithm,
  signingInput,
  signature,
  key,
}) => {
  if (!isTauri()) throw new Error(JWT_VERIFY_NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<boolean>("security_jwt_verify", {
      algorithm,
      signingInput,
      signature,
      key,
    });
  } catch (error) {
    const message =
      typeof error === "string" ? error : error instanceof Error ? error.message : "";
    throw new Error(message || "La vérification de signature a échoué.");
  }
};

export function isJwtVerifyAvailable(): boolean {
  return isTauri();
}
