export const KANBAN_EFFORTS = ["XS", "S", "M", "L", "XL"] as const;

export type KanbanEffort = (typeof KANBAN_EFFORTS)[number];

export const KANBAN_EFFORT_ORDINAL: Record<KanbanEffort, number> = { XS: 0, S: 1, M: 2, L: 3, XL: 4 };
