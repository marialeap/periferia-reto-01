export type AgentToolCall = { name: string; args: Record<string, unknown>; id?: string };
export type AgentMessage = { role: "user" | "model"; parts: Array<Record<string, unknown>> };
export type AgentToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };
export type AgentResult = { text: string; calls: AgentToolCall[]; modelParts: Array<Record<string, unknown>> };
export interface LLMAdapter {
  provider: string;
  model: string;
  enviar(messages: AgentMessage[], tools: AgentToolDefinition[]): Promise<AgentResult>;
}
