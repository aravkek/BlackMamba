export type ChatRole = "user" | "assistant" | "system" | "tool";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  /** Tool invocations made during the assistant's turn that produced this message. */
  toolCalls?: ToolInvocation[];
  /** Wall-clock timestamp for display. */
  createdAt: number;
};

export type ToolInvocation = {
  name: string;
  args: object;
  result: unknown;
};
