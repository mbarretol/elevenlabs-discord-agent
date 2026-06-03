import { logger } from '../config/logger.js';
import {
  createSearchDiscordMessagesTool,
  type DiscordMessageSearchContext,
} from './searchDiscordMessages.js';

export type ClientToolParameters = Record<string, unknown>;

export interface ClientTool {
  names: readonly string[];
  execute(parameters: ClientToolParameters): Promise<string>;
}

export interface ClientToolExecutionResult {
  result: string;
  isError: boolean;
}

export interface ClientTools {
  execute(toolName: string, parameters: ClientToolParameters): Promise<ClientToolExecutionResult>;
}

export interface ClientToolsOptions {
  discordMessageSearch?: DiscordMessageSearchContext;
}

export function createClientTools(options: ClientToolsOptions = {}): ClientTools {
  return new ClientToolRegistry([createSearchDiscordMessagesTool(options.discordMessageSearch)]);
}

class ClientToolRegistry implements ClientTools {
  private readonly tools = new Map<string, ClientTool>();

  constructor(tools: ClientTool[]) {
    tools.forEach(tool => {
      tool.names.forEach(name => this.tools.set(name, tool));
    });
  }

  public async execute(
    toolName: string,
    parameters: ClientToolParameters
  ): Promise<ClientToolExecutionResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        result: `Error: Unsupported tool '${toolName}'.`,
        isError: true,
      };
    }

    try {
      return {
        result: await tool.execute(parameters),
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : `Client tool '${toolName}' failed.`;
      logger.warn(error, `Client tool '${toolName}' failed.`);

      return {
        result: `Error: ${message}`,
        isError: true,
      };
    }
  }
}
