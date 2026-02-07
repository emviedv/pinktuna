/**
 * Plugin ↔ UI Message Protocol
 *
 * Messages flow bidirectionally between the Figma main thread and the UI iframe.
 * The main thread has Figma API access; the UI has DOM/browser APIs.
 */

// Messages from UI to Plugin (main thread)
export type UIToPluginMessage =
  | { type: "GENERATE_TIKTOK" }
  | { type: "CANCEL" }
  | { type: "SET_API_KEY"; apiKey: string };

// Messages from Plugin to UI
export type PluginToUIMessage =
  | { type: "SELECTION_CHANGED"; hasValidSelection: boolean; frameCount: number; frameNames: string[] }
  | { type: "GENERATION_STARTED"; totalFrames: number }
  | { type: "GENERATION_PROGRESS"; stage: string; detail?: string; currentFrame?: number; totalFrames?: number }
  | { type: "GENERATION_COMPLETE"; variantId: string; variantName: string; totalVariants: number }
  | { type: "GENERATION_ERROR"; error: string }
  | { type: "API_KEY_STATUS"; hasKey: boolean };

// Union type for all messages
export type PluginMessage = UIToPluginMessage | PluginToUIMessage;
