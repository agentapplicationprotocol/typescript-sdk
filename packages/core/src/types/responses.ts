import type { AgentInfo } from "./meta.js";
import type { HistoryMessage } from "./messages.js";
import type { HistoryType, SessionInfo, StopReason } from "./session.js";

// --- Responses ---/** JSON response body for non-streaming (`stream: "none"`) requests. */
export interface PostSessionTurnResponse {
  stopReason: StopReason;
  messages: HistoryMessage[];
}

/** Response body for `POST /sessions`. */
export interface PostSessionsResponse {
  sessionId: string;
}

/** Response body for `GET /sessions/:id`. */
export type GetSessionResponse = SessionInfo;

/** Response body for `GET /sessions/:id/history`. */
export interface GetSessionHistoryResponse {
  history: Partial<Record<HistoryType, HistoryMessage[]>>;
}

/** Response body for `GET /sessions`. */
export interface GetSessionsResponse {
  /** Array of session objects. Each object has the same shape as `GetSessionResponse`. */
  sessions: SessionInfo[];
  /** Pagination cursor; absent when there are no more results. Pass as `after` to get the next page. */
  next?: string;
}

/** Response body for `GET /meta`. */
export interface GetMetaResponse {
  /** AAP protocol version. */
  version: 3;
  agents: AgentInfo[];
}
