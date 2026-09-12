import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toolRoute } from "@/core/tools/types";
import { setHandoff, type Handoff } from "./store";

/**
 * Ouvrir un autre outil **avec le fichier déjà chargé**.
 *
 * Sans cela, « Inspecter cette archive » revient à dire à l'utilisateur
 * « redéposez votre fichier ailleurs » : le lien existe, l'aide n'existe pas.
 */
export function useOpenTool() {
  const navigate = useNavigate();
  return useCallback(
    (toolId: string, payload: Omit<Handoff, "toolId"> = {}) => {
      setHandoff({ toolId, ...payload });
      navigate(toolRoute(toolId));
    },
    [navigate],
  );
}
