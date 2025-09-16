import type { ToolHandler } from '../types/tools.js';

/**
 * Maintains the collection of available client tools.
 */
export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  register(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }
}
