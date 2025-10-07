/**
 * Tool Result Registry
 * 
 * Registry pattern for tool result renderers. Each tool can register a renderer
 * that knows how to display its results.
 */

import { ReactNode } from 'react';
import { ToolResultRenderProps } from '../shared/types';

export interface ToolResultRenderer {
  /** Unique tool name */
  toolName: string;
  
  /** Check if this renderer can handle the result */
  canHandle: (result: any) => boolean;
  
  /** Render the result */
  render: (props: ToolResultRenderProps) => ReactNode;
  
  /** Get a concise summary for compact view (optional) */
  getSummary?: (result: any) => string;
}

class ToolResultRegistryClass {
  private renderers: Map<string, ToolResultRenderer> = new Map();
  
  /**
   * Register a tool result renderer
   */
  register(renderer: ToolResultRenderer): void {
    this.renderers.set(renderer.toolName, renderer);
  }
  
  /**
   * Get renderer for a tool
   */
  getRenderer(toolName: string, result: any): ToolResultRenderer | null {
    // Direct match by tool name
    const direct = this.renderers.get(toolName);
    if (direct?.canHandle(result)) {
      return direct;
    }
    
    // Fallback: check all renderers for capability match
    for (const renderer of this.renderers.values()) {
      if (renderer.canHandle(result)) {
        return renderer;
      }
    }
    
    return null;
  }
  
  /**
   * Get all registered tool names
   */
  getAllTools(): string[] {
    return Array.from(this.renderers.keys());
  }
  
  /**
   * Check if a tool is registered
   */
  hasRenderer(toolName: string): boolean {
    return this.renderers.has(toolName);
  }
}

// Singleton instance
export const toolResultRegistry = new ToolResultRegistryClass();

