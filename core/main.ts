/**
 * ScaleResizer Plugin - Main Entry Point
 *
 * A Figma plugin that transforms marketing frames into TikTok vertical format
 * using AI-driven layout analysis.
 *
 * Flow:
 * 1. User selects a frame → Plugin exports image + node tree
 * 2. Single AI call → Returns layout spec for each node
 * 3. Plugin creates 1080×1920 variant → Applies spec using Figma's native layout
 */

import type { UIToPluginMessage, PluginToUIMessage } from "../types/messages";
import { getUIHtml } from "../ui/template";
import { getSelectedFrames, buildNodeTree } from "./selection";
import { exportFrameAsBase64 } from "./image-export";
import { generateLayoutSpec, setApiKey, hasApiKey } from "./ai-service";
import { applyLayoutSpec } from "./spec-applicator";

console.log("[main] Plugin starting...");

// Show the plugin UI
figma.showUI(getUIHtml(), {
  width: 280,
  height: 400,
  themeColors: true,
});
console.log("[main] UI shown");

// Send initial state to UI
notifySelectionChange();
notifyApiKeyStatus();

// Listen for selection changes
figma.on("selectionchange", () => {
  console.log("[main] Selection changed");
  notifySelectionChange();
});

// Handle messages from UI
figma.ui.onmessage = async (msg: UIToPluginMessage) => {
  console.log("[main] Received UI message:", msg.type);

  switch (msg.type) {
    case "GENERATE_TIKTOK":
      await handleGenerate();
      break;

    case "SET_API_KEY":
      console.log("[main] Setting API key (length:", msg.apiKey.length, ")");
      setApiKey(msg.apiKey);
      notifyApiKeyStatus();
      break;

    case "CANCEL":
      console.log("[main] Cancel requested");
      break;
  }
};

/**
 * Send selection status to UI.
 */
function notifySelectionChange(): void {
  const frames = getSelectedFrames();
  const frameNames = frames.map(f => f.name);
  console.log("[main] notifySelectionChange - count:", frames.length, "names:", frameNames.join(", "));
  sendToUI({
    type: "SELECTION_CHANGED",
    hasValidSelection: frames.length > 0,
    frameCount: frames.length,
    frameNames: frameNames,
  });
}

/**
 * Send API key status to UI.
 */
function notifyApiKeyStatus(): void {
  const hasKey = hasApiKey();
  console.log("[main] notifyApiKeyStatus - hasKey:", hasKey);
  sendToUI({
    type: "API_KEY_STATUS",
    hasKey,
  });
}

/**
 * Handle the generate TikTok variant request.
 * Supports multiple selected frames - processes each one sequentially.
 */
async function handleGenerate(): Promise<void> {
  console.log("[main] handleGenerate started");

  const frames = getSelectedFrames();

  if (frames.length === 0) {
    console.log("[main] ERROR: No valid frames selected");
    sendToUI({
      type: "GENERATION_ERROR",
      error: "Please select one or more frames",
    });
    return;
  }

  if (!hasApiKey()) {
    console.log("[main] ERROR: No API key configured");
    sendToUI({
      type: "GENERATION_ERROR",
      error: "Please configure your OpenAI API key",
    });
    return;
  }

  const totalFrames = frames.length;
  console.log("[main] Processing", totalFrames, "frame(s)");

  try {
    sendToUI({ type: "GENERATION_STARTED", totalFrames });

    const allVariants: FrameNode[] = [];

    // Process each frame sequentially
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const frameNum = i + 1;

      console.log(`\n${"=".repeat(70)}`);
      console.log(`[main] Processing frame ${frameNum}/${totalFrames}: ${frame.name}`);
      console.log(`${"=".repeat(70)}`);
      console.log("[main] Frame dimensions:", frame.width, "x", frame.height);

      // Step 1: Export frame as image
      console.log("[main] Step 1: Exporting frame as image...");
      sendToUI({
        type: "GENERATION_PROGRESS",
        stage: `Exporting frame ${frameNum}/${totalFrames}...`,
        detail: `Creating image for AI analysis: ${frame.name}`,
        currentFrame: frameNum,
        totalFrames,
      });
      const imageBase64 = await exportFrameAsBase64(frame);
      console.log("[main] Image exported, base64 length:", imageBase64.length);

      // Step 2: Build node tree
      console.log("[main] Step 2: Building node tree...");
      sendToUI({
        type: "GENERATION_PROGRESS",
        stage: `Analyzing structure ${frameNum}/${totalFrames}...`,
        detail: `Building node tree: ${frame.name}`,
        currentFrame: frameNum,
        totalFrames,
      });
      const nodeTree = buildNodeTree(frame);
      console.log("[main] Node tree built, root:", nodeTree.name, "children:", nodeTree.children?.length ?? 0);

      // Step 3: Call AI to get layout spec
      console.log("[main] Step 3: Calling AI for layout spec...");
      sendToUI({
        type: "GENERATION_PROGRESS",
        stage: `AI analyzing ${frameNum}/${totalFrames}...`,
        detail: `Generating TikTok layout: ${frame.name}`,
        currentFrame: frameNum,
        totalFrames,
      });
      const layoutSpec = await generateLayoutSpec(
        imageBase64,
        nodeTree,
        frame.width,
        frame.height
      );
      console.log("[main] Layout spec received, nodes:", layoutSpec.nodes.length);
      console.log("[main] Layout spec reasoning:", layoutSpec.reasoning);

      // Step 4: Apply the layout spec
      console.log("[main] Step 4: Applying layout spec...");
      sendToUI({
        type: "GENERATION_PROGRESS",
        stage: `Creating variants ${frameNum}/${totalFrames}...`,
        detail: `Applying layout: ${frame.name}`,
        currentFrame: frameNum,
        totalFrames,
      });
      const variant = await applyLayoutSpec(frame, layoutSpec);
      console.log("[main] Variant created:", variant.name, "id:", variant.id);

      allVariants.push(variant);
    }

    // Switch to the output page where variants live
    const outputPage = allVariants[0].parent as PageNode;
    console.log("[main] Switching to output page:", outputPage.name);
    await figma.setCurrentPageAsync(outputPage);

    // Select all new variants
    figma.currentPage.selection = allVariants;
    figma.viewport.scrollAndZoomIntoView(allVariants);
    console.log("[main] All variants selected and scrolled into view");

    sendToUI({
      type: "GENERATION_COMPLETE",
      variantId: allVariants[0].id,
      variantName: allVariants.map(v => v.name).join(", "),
      totalVariants: allVariants.length,
    });
    console.log("[main] Generation complete! Created", allVariants.length, "variant set(s)");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[main] ERROR:", errorMessage);
    console.error("[main] Full error:", error);
    sendToUI({
      type: "GENERATION_ERROR",
      error: errorMessage,
    });
  }
}

/**
 * Type-safe wrapper for sending messages to UI.
 */
function sendToUI(message: PluginToUIMessage): void {
  console.log("[main] Sending to UI:", message.type);
  figma.ui.postMessage(message);
}
