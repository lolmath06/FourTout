import { useMemo } from "react";
import {
  activeJobs,
  latestJobForTool,
  useJobStore,
  type Job,
} from "./store";

/**
 * Reconnexion de l'interface au job global d'un outil.
 *
 * Le composant n'est plus propriétaire du traitement : il s'y **abonne**. En
 * revenant sur l'outil, ce hook retrouve le job en cours (ou son résultat) sans
 * rien relancer.
 */
export function useToolJob(toolId: string): Job | undefined {
  const jobs = useJobStore((state) => state.jobs);
  const order = useJobStore((state) => state.order);
  return useMemo(() => latestJobForTool({ jobs, order }, toolId), [jobs, order, toolId]);
}

/** Les jobs actuellement actifs (pour l'indicateur global). */
export function useActiveJobs(): Job[] {
  const jobs = useJobStore((state) => state.jobs);
  const order = useJobStore((state) => state.order);
  return useMemo(() => activeJobs({ jobs, order }), [jobs, order]);
}
