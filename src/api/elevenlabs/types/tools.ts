export interface ToolInvocation {
  parameters: Record<string, unknown> | undefined;
  toolCallId: string;
  respond: (output: string, isError?: boolean) => void;
}

export type ToolHandler = (invocation: ToolInvocation) => Promise<void>;
