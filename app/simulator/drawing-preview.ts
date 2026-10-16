import type { ReactNode } from "react";

/** Read-only presentation data. No circuit mutations or authorization claims. */
export type DrawingPreview = { key: string; title: string; src?: string; type?: string; content?: ReactNode };
