/** Explicit local folder selection. The project grants no filesystem permission. */
export interface LocalProject {
  defaultAccountId?: string;
  mainSessionId?: string;
  lastOpenedAt?: number;
  id: string;
  name: string;
  path: string;
  createdAt: number;
  /** Removed sidebar group; existing conversations and queued work retain their folder. */
  ungrouped?: boolean;
}
