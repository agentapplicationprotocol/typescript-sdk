export interface TextAgentOption {
  type: "text";
  name: string;
  title?: string;
  description?: string;
  default: string;
}

export interface SecretAgentOption {
  type: "secret";
  name: string;
  title?: string;
  description?: string;
  default: string;
}

export interface SelectAgentOption {
  type: "select";
  name: string;
  title?: string;
  description?: string;
  options: string[];
  default: string;
}

/** A configurable option the client may set per request. */
export type AgentOption = TextAgentOption | SecretAgentOption | SelectAgentOption;
