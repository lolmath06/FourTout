import { create } from "zustand";

/**
 * Retour utilisateur unifié : succès, erreur, avertissement, information et
 * opération en cours. Remplace tout appel à `alert()` dans l'application.
 */
export type NoticeKind = "success" | "error" | "warning" | "info" | "loading";

export interface Notice {
  id: string;
  kind: NoticeKind;
  title: string;
  description?: string;
  /** Durée d'affichage en ms ; `0` = jusqu'à fermeture explicite. */
  duration: number;
  createdAt: number;
}

export interface NoticeInput {
  kind?: NoticeKind;
  title: string;
  description?: string;
  duration?: number;
}

interface NotificationsState {
  notices: Notice[];
  push: (input: NoticeInput) => string;
  update: (id: string, patch: Partial<NoticeInput>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION: Record<NoticeKind, number> = {
  success: 3500,
  info: 4000,
  warning: 6000,
  error: 8000,
  // Une opération en cours reste affichée jusqu'à son dénouement.
  loading: 0,
};

let sequence = 0;

export const useNotifications = create<NotificationsState>((set) => ({
  notices: [],
  push: ({ kind = "info", title, description, duration }) => {
    sequence += 1;
    const id = `notice-${sequence}`;
    const notice: Notice = {
      id,
      kind,
      title,
      description,
      duration: duration ?? DEFAULT_DURATION[kind],
      createdAt: Date.now(),
    };
    set((state) => ({ notices: [...state.notices, notice] }));
    return id;
  },
  update: (id, patch) =>
    set((state) => ({
      notices: state.notices.map((notice) =>
        notice.id === id
          ? {
              ...notice,
              ...patch,
              duration: patch.duration ?? (patch.kind ? DEFAULT_DURATION[patch.kind] : notice.duration),
            }
          : notice,
      ),
    })),
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
  clear: () => set({ notices: [] }),
}));

/**
 * Raccourcis impératifs, utilisables hors composant React.
 * `notify.loading()` renvoie l'id à passer ensuite à `notify.update()`.
 */
export const notify = {
  success: (title: string, description?: string) =>
    useNotifications.getState().push({ kind: "success", title, description }),
  error: (title: string, description?: string) =>
    useNotifications.getState().push({ kind: "error", title, description }),
  warning: (title: string, description?: string) =>
    useNotifications.getState().push({ kind: "warning", title, description }),
  info: (title: string, description?: string) =>
    useNotifications.getState().push({ kind: "info", title, description }),
  loading: (title: string, description?: string) =>
    useNotifications.getState().push({ kind: "loading", title, description }),
  update: (id: string, patch: Partial<NoticeInput>) =>
    useNotifications.getState().update(id, patch),
  dismiss: (id: string) => useNotifications.getState().dismiss(id),
};
