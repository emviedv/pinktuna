/**
 * Spec Applicator Module
 *
 * Creates the TikTok variant frame and applies the layout specification
 * using Figma's native auto-layout system.
 */

import type { LayoutSpec, NodeSpec, SemanticGroup } from "../types/layout-spec";

/** TikTok vertical dimensions */
const TIKTOK_WIDTH = 1080;
const TIKTOK_HEIGHT = 1920;

console.log("[spec-applicator] Module loaded, TikTok dimensions:", TIKTOK_WIDTH, "x", TIKTOK_HEIGHT);

/** Original position data for preserving element positions during adaptation */
interface OriginalPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Positioning modes for comparison testing.
 * - PRESERVE_SPACING: Keep original X positions/spacing, center horizontally, scale Y with offset
 * - UNIFORM_SCALED: Scale positions AND dimensions uniformly (preserves edge gaps but distorts components)
 * - AI_DETERMINED: Use AI-specified x/y coordinates directly
 * - HYBRID: Per-element strategy based on semantic group's preserveSpacing flag
 * - AD_X_PRESERVE_Y_AI: Preserve X spacing from Mode A, use AI Y from Mode D
 * - AD_X_AI_Y_PRESERVE: Use AI X from Mode D, preserve Y spacing from Mode A
 * - AD_BLEND_50: Equal 50/50 blend of Mode A and Mode D positions
 * - AD_BLEND_70_30: Weighted 70% A + 30% D blend (favors spacing preservation)
 * - NATIVE_FIGMA: Uses ONLY native Figma API features (wrap, grid, min/max constraints)
 * - NATIVE_PLUS_ABSOLUTE: Combines native Figma features with absolute positioning
 * - NATIVE_SMART: Native Figma with intelligent composition (visual hierarchy, rhythm)
 * - NATIVE_GRID: Native Figma focusing on auto-layout grid patterns
 */
type PositioningMode =
  | "PRESERVE_SPACING"
  | "UNIFORM_SCALED"
  | "AI_DETERMINED"
  | "HYBRID"
  | "AD_X_PRESERVE_Y_AI"
  | "AD_X_AI_Y_PRESERVE"
  | "AD_BLEND_50"
  | "AD_BLEND_70_30"
  | "NATIVE_FIGMA"
  | "NATIVE_PLUS_ABSOLUTE"
  | "NATIVE_SMART"
  | "NATIVE_GRID";

/**
 * Capture original positions of all nodes before resize.
 * This allows us to preserve relative positions when adapting to TikTok format.
 */
function captureOriginalPositions(frame: FrameNode): Map<string, OriginalPosition> {
  const positions = new Map<string, OriginalPosition>();

  function walkAndCapture(node: SceneNode): void {
    positions.set(node.id, {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    });

    if ("children" in node) {
      for (const child of node.children as readonly SceneNode[]) {
        walkAndCapture(child);
      }
    }
  }

  // Capture positions of all direct children (not the frame itself)
  for (const child of frame.children) {
    walkAndCapture(child);
  }

  return positions;
}

/**
 * Build a mapping from source node IDs to cloned node IDs.
 * Walks both trees in parallel, matching by structure position.
 *
 * @param source - The original node tree
 * @param clone - The cloned node tree
 * @returns Map from source ID to clone ID
 */
function buildIdMapping(source: SceneNode, clone: SceneNode): Map<string, string> {
  const mapping = new Map<string, string>();

  function walkParallel(src: SceneNode, cloned: SceneNode): void {
    // Map this node
    mapping.set(src.id, cloned.id);
    console.log(`[buildIdMapping] ${src.id} (${src.name}) → ${cloned.id}`);

    // Recurse into children if both have them
    if ("children" in src && "children" in cloned) {
      const srcChildren = src.children as readonly SceneNode[];
      const clonedChildren = cloned.children as readonly SceneNode[];

      // Match by index (structure should be identical after clone)
      const len = Math.min(srcChildren.length, clonedChildren.length);
      for (let i = 0; i < len; i++) {
        walkParallel(srcChildren[i], clonedChildren[i]);
      }
    }
  }

  walkParallel(source, clone);
  console.log(`[buildIdMapping] Total mappings: ${mapping.size}`);
  return mapping;
}

/**
 * Remap node IDs in a spec using the source-to-clone mapping.
 * Modifies the spec in place.
 */
function remapSpecIds(spec: LayoutSpec, idMap: Map<string, string>): void {
  console.log("[remapSpecIds] Remapping spec IDs...");

  // Remap nodes array
  // IMPORTANT: If no mapping exists, KEEP the original ID (don't clear it)
  // This is critical for the second remapping pass where only converted groups have new IDs
  for (const nodeSpec of spec.nodes) {
    const newId = idMap.get(nodeSpec.nodeId);
    if (newId) {
      console.log(`[remapSpecIds] Node ${nodeSpec.nodeName}: ${nodeSpec.nodeId} → ${newId}`);
      nodeSpec.nodeId = newId;
    } else {
      console.log(`[remapSpecIds] Node ${nodeSpec.nodeName}: keeping ${nodeSpec.nodeId} (no mapping)`);
    }
  }

  // Remap semantic groups
  // IMPORTANT: If no mapping exists, KEEP the original ID (don't drop it)
  // This is critical for the second remapping pass where only converted groups have new IDs
  if (spec.semanticGroups) {
    for (const group of spec.semanticGroups) {
      const remappedIds: string[] = [];
      for (const nodeId of group.nodeIds) {
        const newId = idMap.get(nodeId);
        if (newId) {
          console.log(`[remapSpecIds] Group ${group.groupId}: ${nodeId} → ${newId}`);
          remappedIds.push(newId);
        } else {
          // Keep original ID - no mapping means it wasn't converted/changed
          console.log(`[remapSpecIds] Group ${group.groupId}: keeping ${nodeId} (no mapping)`);
          remappedIds.push(nodeId);
        }
      }
      group.nodeIds = remappedIds;
    }
  }

  console.log("[remapSpecIds] Remapping complete");
}

/**
 * Deep clone a LayoutSpec to avoid mutations between variants.
 */
function deepCloneSpec(spec: LayoutSpec): LayoutSpec {
  return JSON.parse(JSON.stringify(spec));
}

/**
 * Apply a layout specification to create TikTok variant(s).
 * Creates 12 comparison variants with different positioning modes:
 * - A) HYBRID: Per-element strategy based on preserveSpacing
 * - B) PRESERVE_SPACING: Original spacing, centered horizontally
 * - C) UNIFORM_SCALED: Positions AND sizes scaled uniformly
 * - D) AI_DETERMINED: Using AI-specified coordinates
 * - E) AD_X_PRESERVE_Y_AI: Preserve X spacing, use AI Y
 * - F) AD_X_AI_Y_PRESERVE: Use AI X, preserve Y spacing
 * - G) AD_BLEND_50: 50% A + 50% D position blend
 * - H) AD_BLEND_70_30: 70% A + 30% D position blend
 * - I) NATIVE_FIGMA: Uses ONLY native Figma API (wrap, grid, constraints)
 * - J) NATIVE_PLUS_ABSOLUTE: Combines native features with absolute positioning
 * - K) NATIVE_SMART: Native API with intelligent composition (hierarchy, rhythm)
 * - L) NATIVE_GRID: Native API with auto-layout grid patterns and columns
 *
 * @param sourceFrame - The original frame to transform
 * @param spec - The layout specification from the AI
 * @returns The first created TikTok variant frame (HYBRID mode)
 */
export async function applyLayoutSpec(
  sourceFrame: FrameNode,
  spec: LayoutSpec
): Promise<FrameNode> {
  console.log("[spec-applicator] applyLayoutSpec started - COMPARISON MODE (12 variants: A-L)");
  console.log("[spec-applicator] Source frame:", sourceFrame.name, "id:", sourceFrame.id);
  console.log("[spec-applicator] Spec nodes count:", spec.nodes.length);
  console.log("[spec-applicator] Semantic groups:", spec.semanticGroups?.length ?? 0, spec.semanticGroups?.filter(g => g.preserveSpacing).length ?? 0, "with preserveSpacing");

  // Define the 12 positioning modes to compare (original 4 + 4 A+D hybrids + 4 Native variants)
  const modes: Array<{ mode: PositioningMode; label: string; description: string }> = [
    { mode: "HYBRID", label: "A) Hybrid", description: "Per-element strategy based on preserveSpacing" },
    { mode: "PRESERVE_SPACING", label: "B) Preserve Gap", description: "Original spacing, centered horizontally" },
    { mode: "UNIFORM_SCALED", label: "C) Uniform All", description: "Positions AND sizes scaled 0.9x" },
    { mode: "AI_DETERMINED", label: "D) AI Position", description: "Using AI coordinates" },
    // NEW A+D Hybrids
    { mode: "AD_X_PRESERVE_Y_AI", label: "E) A's X + D's Y", description: "Preserve X spacing, AI Y position" },
    { mode: "AD_X_AI_Y_PRESERVE", label: "F) D's X + A's Y", description: "AI X position, preserve Y spacing" },
    { mode: "AD_BLEND_50", label: "G) 50/50 Blend", description: "50% A + 50% D position blend" },
    { mode: "AD_BLEND_70_30", label: "H) 70A/30D", description: "70% A + 30% D position blend" },
    // Native Figma API strategy (no absolute positioning)
    { mode: "NATIVE_FIGMA", label: "I) Native Figma", description: "Wrap, grid, min/max constraints only" },
    // Native Figma + absolute positioning hybrid
    { mode: "NATIVE_PLUS_ABSOLUTE", label: "J) Native+Abs", description: "Native features + absolute positioning" },
    // Native Figma with intelligent composition
    { mode: "NATIVE_SMART", label: "K) Native Smart", description: "Native API + visual hierarchy + rhythm" },
    // Native Figma focusing on auto-layout and grid
    { mode: "NATIVE_GRID", label: "L) Native Grid", description: "Auto-layout grid patterns + columns" },
  ];

  // Get or create the dedicated TikTok outputs page
  const outputPage = getOrCreateOutputPage();
  const nextY = getNextYPosition(outputPage);

  const variants: FrameNode[] = [];
  const GAP_BETWEEN_VARIANTS = 100;

  for (let i = 0; i < modes.length; i++) {
    const { mode, label, description } = modes[i];

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[spec-applicator] Creating variant ${i + 1}/${modes.length}: ${label}`);
    console.log(`[spec-applicator] Mode: ${mode} - ${description}`);
    console.log(`${"=".repeat(70)}`);

    // Deep clone the spec for each variant (remapping modifies it)
    const variantSpec = deepCloneSpec(spec);

    // Clone the source frame
    const variant = sourceFrame.clone();
    variant.name = `${sourceFrame.name} - ${label}`;
    console.log("[spec-applicator] Clone created:", variant.name);

    // Build ID mapping and remap
    const idMap = buildIdMapping(sourceFrame, variant);
    remapSpecIds(variantSpec, idMap);

    // Move to output page
    outputPage.appendChild(variant);

    // Position variants side by side horizontally
    variant.x = i * (TIKTOK_WIDTH + GAP_BETWEEN_VARIANTS);
    variant.y = nextY;
    console.log("[spec-applicator] Positioned at:", variant.x, variant.y);

    // Capture original positions BEFORE resize
    const originalWidth = variant.width;
    const originalHeight = variant.height;
    const originalPositions = captureOriginalPositions(variant);
    console.log("[spec-applicator] Captured", originalPositions.size, "original positions");

    // Resize to TikTok dimensions
    variant.resize(TIKTOK_WIDTH, TIKTOK_HEIGHT);

    // Build spec map
    const specMap = new Map<string, NodeSpec>();
    for (const nodeSpec of variantSpec.nodes) {
      specMap.set(nodeSpec.nodeId, nodeSpec);
    }

    // Apply root layout
    applyRootLayout(variant, variantSpec.rootLayout);

    // Apply MODE-SPECIFIC overrides to make variants visually distinct
    // This is critical because absolute positioning code path may not be reached
    applyModeSpecificLayout(variant, mode);

    // Convert nested containers to auto-layout
    const conversionIdChanges = convertToAutoLayout(variant, specMap);
    if (conversionIdChanges.size > 0) {
      remapSpecIds(variantSpec, conversionIdChanges);
      for (const [oldId, newId] of conversionIdChanges) {
        const nodeSpec = specMap.get(oldId);
        if (nodeSpec) {
          specMap.delete(oldId);
          nodeSpec.nodeId = newId;
          specMap.set(newId, nodeSpec);
        }
        // Also remap originalPositions so converted nodes can be found
        const pos = originalPositions.get(oldId);
        if (pos) {
          originalPositions.set(newId, pos);
        }
      }
    }

    // Apply semantic grouping if present
    let hasSemanticGroups = false;
    if (variantSpec.semanticGroups && variantSpec.semanticGroups.length > 0) {
      hasSemanticGroups = true;
      applySemanticGrouping(variant, variantSpec.semanticGroups, specMap);
    }

    // Apply node specs
    await applyNodeSpecs(variant, specMap);

    // Reorder children if no semantic groups
    if (!hasSemanticGroups) {
      reorderChildren(variant, specMap);
    }

    // Apply positioning strategy based on MODE
    console.log(`[spec-applicator] Applying ${mode} positioning...`);
    if (mode === "NATIVE_FIGMA") {
      // Native Figma mode: use ONLY native Figma API features (wrap, constraints, etc.)
      // This completely skips absolute positioning for a visually distinct result
      applyNativeFigmaLayout(variant, specMap, originalWidth, originalHeight);
    } else if (mode === "NATIVE_PLUS_ABSOLUTE") {
      // Hybrid mode: apply native Figma features FIRST, then absolute positioning
      // This combines wrap/constraints with precise element placement
      applyNativeFigmaLayout(variant, specMap, originalWidth, originalHeight);
      applyAbsolutePositioning(variant, specMap, originalPositions, originalWidth, originalHeight, "HYBRID", variantSpec.semanticGroups ?? []);
    } else if (mode === "NATIVE_SMART") {
      // Smart native mode: intelligent composition with visual hierarchy and rhythm
      applyNativeSmartLayout(variant, specMap, variantSpec.semanticGroups ?? [], originalWidth, originalHeight);
    } else if (mode === "NATIVE_GRID") {
      // Grid native mode: auto-layout with grid patterns and columns
      applyNativeGridLayout(variant, specMap, originalWidth, originalHeight);
    } else {
      // All other modes use absolute positioning strategies
      applyAbsolutePositioning(variant, specMap, originalPositions, originalWidth, originalHeight, mode, variantSpec.semanticGroups ?? []);
    }

    // Phase 2 transforms
    applyAspectLockedScaling(variant, specMap);
    applyRotation(variant, specMap);
    applyAnchorPoints(variant, specMap);
    applyZIndexOrdering(variant, specMap);

    // Preserve aspect ratios for all images and vectors (auto-applied, not spec-dependent)
    preserveImageVectorAspectRatios(variant, originalPositions);

    // FINAL DIMENSION ENFORCEMENT - ensure frame is exactly TikTok size
    // Auto-layout and other transforms can sometimes change frame dimensions
    if (variant.width !== TIKTOK_WIDTH || variant.height !== TIKTOK_HEIGHT) {
      console.log(`[spec-applicator] ⚠️ Frame dimensions drifted: ${variant.width}x${variant.height}`);
      console.log(`[spec-applicator] >>> Enforcing TikTok dimensions: ${TIKTOK_WIDTH}x${TIKTOK_HEIGHT}`);
      variant.resize(TIKTOK_WIDTH, TIKTOK_HEIGHT);
    }
    // Ensure sizing mode is FIXED so dimensions don't change
    variant.layoutSizingHorizontal = "FIXED";
    variant.layoutSizingVertical = "FIXED";
    console.log(`[spec-applicator] Final frame: ${variant.width}x${variant.height} (sizing: FIXED)`);

    variants.push(variant);
    console.log(`[spec-applicator] Variant ${label} complete`);
  }

  console.log(`\n[spec-applicator] All ${modes.length} comparison variants created!`);
  console.log("[spec-applicator] Layout application complete");

  // Return the first variant (HYBRID) as the primary result
  return variants[0];
}

/** Minimum horizontal padding for TikTok format (40-80px range, using 60px) */
const MIN_HORIZONTAL_PADDING = 60;

/** Standard padding for ALL variants - ensures visual consistency */
const STANDARD_PADDING = {
  top: 140,
  right: 60,
  bottom: 200,
  left: 60,
};

/**
 * Apply MODE-SPECIFIC layout overrides to make each variant visually distinct.
 * This is the KEY function that differentiates A-H variants.
 *
 * NOTE: Padding is STANDARDIZED across all variants (via STANDARD_PADDING).
 * Only gap and alignment settings differ between modes.
 */
function applyModeSpecificLayout(frame: FrameNode, mode: PositioningMode): void {
  console.log(`[applyModeSpecificLayout] Applying mode-specific overrides for: ${mode}`);

  // Apply STANDARD padding to ALL modes for consistency
  frame.paddingTop = STANDARD_PADDING.top;
  frame.paddingRight = STANDARD_PADDING.right;
  frame.paddingBottom = STANDARD_PADDING.bottom;
  frame.paddingLeft = STANDARD_PADDING.left;
  console.log(`[applyModeSpecificLayout] Standard padding: T${STANDARD_PADDING.top} R${STANDARD_PADDING.right} B${STANDARD_PADDING.bottom} L${STANDARD_PADDING.left}`);

  // Each mode gets VISUALLY DISTINCT gap/alignment settings (NOT padding)
  switch (mode) {
    case "HYBRID":
      // A) Small gap, top-aligned
      frame.itemSpacing = 16;
      frame.primaryAxisAlignItems = "MIN";
      frame.counterAxisAlignItems = "CENTER";
      console.log(`[applyModeSpecificLayout] A) HYBRID: gap=16, top-aligned`);
      break;

    case "PRESERVE_SPACING":
      // B) Medium gap, centered
      frame.itemSpacing = 24;
      frame.primaryAxisAlignItems = "CENTER";
      frame.counterAxisAlignItems = "CENTER";
      console.log(`[applyModeSpecificLayout] B) PRESERVE_SPACING: gap=24, centered`);
      break;

    case "UNIFORM_SCALED":
      // C) Large gap, space-between
      frame.itemSpacing = 32;
      frame.primaryAxisAlignItems = "SPACE_BETWEEN";
      frame.counterAxisAlignItems = "CENTER";
      console.log(`[applyModeSpecificLayout] C) UNIFORM_SCALED: gap=32, space-between`);
      break;

    case "AI_DETERMINED":
      // D) Tight gap, bottom-aligned
      frame.itemSpacing = 12;
      frame.primaryAxisAlignItems = "MAX";
      frame.counterAxisAlignItems = "CENTER";
      console.log(`[applyModeSpecificLayout] D) AI_DETERMINED: gap=12, bottom-aligned`);
      break;

    case "AD_X_PRESERVE_Y_AI":
      // E) Medium gap, left-aligned
      frame.itemSpacing = 20;
      frame.primaryAxisAlignItems = "MIN";
      frame.counterAxisAlignItems = "MIN";
      console.log(`[applyModeSpecificLayout] E) AD_X_PRESERVE_Y_AI: gap=20, left-aligned`);
      break;

    case "AD_X_AI_Y_PRESERVE":
      // F) Medium gap, right-aligned
      frame.itemSpacing = 20;
      frame.primaryAxisAlignItems = "MIN";
      frame.counterAxisAlignItems = "MAX";
      console.log(`[applyModeSpecificLayout] F) AD_X_AI_Y_PRESERVE: gap=20, right-aligned`);
      break;

    case "AD_BLEND_50":
      // G) Extra large gaps, centered
      frame.itemSpacing = 48;
      frame.primaryAxisAlignItems = "CENTER";
      frame.counterAxisAlignItems = "CENTER";
      console.log(`[applyModeSpecificLayout] G) AD_BLEND_50: gap=48, centered`);
      break;

    case "AD_BLEND_70_30":
      // H) Minimal gaps, top-aligned
      frame.itemSpacing = 8;
      frame.primaryAxisAlignItems = "MIN";
      frame.counterAxisAlignItems = "CENTER";
      console.log(`[applyModeSpecificLayout] H) AD_BLEND_70_30: gap=8, top-aligned`);
      break;

    case "NATIVE_FIGMA":
    case "NATIVE_PLUS_ABSOLUTE":
      // I/J handled by applyNativeFigmaLayout - no overrides here
      console.log(`[applyModeSpecificLayout] ${mode}: handled by applyNativeFigmaLayout`);
      break;

    case "NATIVE_SMART":
      // K handled by applyNativeSmartLayout - no overrides here
      console.log(`[applyModeSpecificLayout] ${mode}: handled by applyNativeSmartLayout`);
      break;

    case "NATIVE_GRID":
      // L handled by applyNativeGridLayout - no overrides here
      console.log(`[applyModeSpecificLayout] ${mode}: handled by applyNativeGridLayout`);
      break;

    default:
      console.log(`[applyModeSpecificLayout] Unknown mode: ${mode}, no overrides`);
  }
}

/**
 * Apply root layout configuration to the variant frame.
 */
function applyRootLayout(frame: FrameNode, layout: LayoutSpec["rootLayout"]): void {
  console.log("[spec-applicator] applyRootLayout - frame:", frame.name);
  console.log("[spec-applicator] Layout config:", JSON.stringify(layout));
  console.log("[spec-applicator] AI-specified padding:", JSON.stringify(layout.padding));

  // Enable auto-layout with vertical direction
  frame.layoutMode = "VERTICAL";
  console.log("[spec-applicator] Set layoutMode to VERTICAL");

  // Apply padding with ENFORCED MINIMUM for horizontal padding
  // AI often specifies 40px, but TikTok format needs 60-80px for breathing room
  const effectivePaddingLeft = Math.max(layout.padding.left, MIN_HORIZONTAL_PADDING);
  const effectivePaddingRight = Math.max(layout.padding.right, MIN_HORIZONTAL_PADDING);

  frame.paddingTop = layout.padding.top;
  frame.paddingRight = effectivePaddingRight;
  frame.paddingBottom = layout.padding.bottom;
  frame.paddingLeft = effectivePaddingLeft;

  console.log("[spec-applicator] Applied padding (with min horizontal enforcement):");
  console.log(`  Top: ${layout.padding.top}`);
  console.log(`  Right: ${layout.padding.right} → ${effectivePaddingRight} (min: ${MIN_HORIZONTAL_PADDING})`);
  console.log(`  Bottom: ${layout.padding.bottom}`);
  console.log(`  Left: ${layout.padding.left} → ${effectivePaddingLeft} (min: ${MIN_HORIZONTAL_PADDING})`);

  // Apply gap
  frame.itemSpacing = layout.gap;
  console.log("[spec-applicator] Applied gap:", layout.gap);

  // Apply alignment
  frame.primaryAxisAlignItems = layout.primaryAxisAlign;
  frame.counterAxisAlignItems = layout.counterAxisAlign;
  console.log("[spec-applicator] Applied alignment - primary:", layout.primaryAxisAlign, "counter:", layout.counterAxisAlign);

  // Ensure frame sizing is fixed (we set the dimensions explicitly)
  frame.layoutSizingHorizontal = "FIXED";
  frame.layoutSizingVertical = "FIXED";
  console.log("[spec-applicator] Set sizing to FIXED");

  // ALWAYS enable clip content on output frames to prevent content bleeding
  // This ensures clean visual boundaries regardless of AI specification
  frame.clipsContent = true;
  console.log("[spec-applicator] Set clipsContent: true (always enforced on output frames)");
}

/**
 * Recursively apply node specs to all descendants.
 */
async function applyNodeSpecs(
  parent: FrameNode | GroupNode,
  specMap: Map<string, NodeSpec>
): Promise<void> {
  const children = [...parent.children] as SceneNode[];
  console.log("[spec-applicator] applyNodeSpecs - parent:", parent.name, "children count:", children.length);

  for (const child of children) {
    // CRITICAL: Skip nodes inside component instances - they're frozen
    if (isInsideComponentInstance(child)) {
      console.log("[spec-applicator] SKIP (inside component):", child.name, "id:", child.id);
      continue;
    }

    const spec = specMap.get(child.id);

    if (spec) {
      console.log("[spec-applicator] Applying spec to:", child.name, "id:", child.id);
      console.log("[spec-applicator]   visible:", spec.visible, "order:", spec.order);
      console.log("[spec-applicator]   sizing:", spec.widthSizing, "x", spec.heightSizing);

      // Apply visibility
      child.visible = spec.visible;

      // Apply sizing modes (only for nodes that support it)
      // IMPORTANT: HUG sizing requires auto-layout - skip for non-auto-layout frames
      if ("layoutSizingHorizontal" in child) {
        const isAutoLayoutFrame = child.type === "FRAME" && (child as FrameNode).layoutMode !== "NONE";
        const widthMode = sizingModeToFigma(spec.widthSizing);
        const heightMode = sizingModeToFigma(spec.heightSizing);

        // Only apply HUG to auto-layout frames (Figma requirement)
        if (widthMode === "HUG" && !isAutoLayoutFrame) {
          console.log("[spec-applicator]   SKIP width HUG - frame has no auto-layout");
        } else {
          child.layoutSizingHorizontal = widthMode;
        }

        if (heightMode === "HUG" && !isAutoLayoutFrame) {
          console.log("[spec-applicator]   SKIP height HUG - frame has no auto-layout");
        } else {
          child.layoutSizingVertical = heightMode;
        }
        console.log("[spec-applicator]   Applied sizing modes (auto-layout:", isAutoLayoutFrame, ")");
      }

      // Apply scale factor if specified
      if (spec.scaleFactor && spec.scaleFactor !== 1 && "resize" in child) {
        const currentWidth = child.width;
        const currentHeight = child.height;
        child.resize(
          currentWidth * spec.scaleFactor,
          currentHeight * spec.scaleFactor
        );
        console.log("[spec-applicator]   Applied scale factor:", spec.scaleFactor);
      }
    } else {
      console.log("[spec-applicator] No spec for node:", child.name, "id:", child.id);
    }

    // Recurse into container nodes
    if ("children" in child) {
      await applyNodeSpecs(child as FrameNode | GroupNode, specMap);
    }
  }
}

/**
 * Reorder children based on the order values in the spec.
 * Only reorders direct children of frames with auto-layout.
 */
function reorderChildren(
  parent: FrameNode,
  specMap: Map<string, NodeSpec>
): void {
  console.log("[spec-applicator] reorderChildren - parent:", parent.name, "layoutMode:", parent.layoutMode);

  // Only reorder if parent has auto-layout
  if (parent.layoutMode === "NONE") {
    console.log("[spec-applicator] Skipping reorder - no auto-layout");
    return;
  }

  const children = [...parent.children] as SceneNode[];

  // Get order values for children, defaulting to a high number for unspecified nodes
  const childOrders: Array<{ node: SceneNode; order: number }> = children.map((child) => {
    const spec = specMap.get(child.id);
    return {
      node: child,
      order: spec?.order ?? 999,
    };
  });

  console.log("[spec-applicator] Child orders before sort:", childOrders.map(c => `${c.node.name}:${c.order}`).join(", "));

  // Sort by order value
  childOrders.sort((a, b) => a.order - b.order);

  console.log("[spec-applicator] Child orders after sort:", childOrders.map(c => `${c.node.name}:${c.order}`).join(", "));

  // Reorder in Figma by moving each child to its correct position
  for (let i = 0; i < childOrders.length; i++) {
    const { node } = childOrders[i];
    parent.insertChild(i, node);
  }
  console.log("[spec-applicator] Children reordered");

  // Recurse into child frames
  for (const child of parent.children) {
    if (child.type === "FRAME" && child.layoutMode !== "NONE") {
      reorderChildren(child, specMap);
    }
  }
}

/**
 * Convert nested containers to auto-layout for proper child reordering.
 *
 * This function:
 * 1. Converts Groups to Frames (Groups can't have auto-layout)
 * 2. Enables auto-layout on Frames with layoutMode === "NONE"
 * 3. Respects AI-specified layoutDirection (default: VERTICAL)
 * 4. Skips component instances (frozen, can't modify)
 * 5. Recurses into nested containers
 * 6. Returns a map of old IDs → new IDs for converted groups
 *
 * @param parent - The container to process
 * @param specMap - Map of node specs for layoutDirection lookup
 * @param idChanges - Map to track ID changes during group conversion
 */
function convertToAutoLayout(
  parent: FrameNode | GroupNode,
  specMap: Map<string, NodeSpec>,
  idChanges: Map<string, string> = new Map()
): Map<string, string> {
  console.log("[convertToAutoLayout] parent:", parent.name, "type:", parent.type);

  // CRITICAL: Don't process nodes inside component instances - they're frozen
  if (isInsideComponentInstance(parent)) {
    console.log("[convertToAutoLayout] ABORT - parent is inside a component instance:", parent.name);
    return idChanges;
  }

  const children = [...parent.children] as SceneNode[];

  for (const child of children) {
    // Skip component instances - they're frozen and can't be modified
    if (child.type === "INSTANCE") {
      console.log("[convertToAutoLayout] SKIPPING INSTANCE:", child.name, "id:", child.id);
      console.log("[convertToAutoLayout]   Instance is frozen - cannot modify structure");
      continue;
    }

    // Skip COMPONENT definitions
    if (child.type === "COMPONENT") {
      console.log("[convertToAutoLayout] SKIPPING COMPONENT:", child.name, "id:", child.id);
      console.log("[convertToAutoLayout]   Component definitions should not be modified");
      continue;
    }

    // Get spec for this node to check layoutDirection
    const spec = specMap.get(child.id);
    const layoutDirection = spec?.layoutDirection ?? "VERTICAL"; // Default to VERTICAL
    console.log("[convertToAutoLayout] Processing:", child.name, "type:", child.type, "layoutDirection:", layoutDirection);

    // If AI explicitly requested "NONE", skip conversion
    if (layoutDirection === "NONE") {
      console.log("[convertToAutoLayout] AI requested NONE for:", child.name, "- keeping absolute positioning");
      // Still recurse into children - pass idChanges to track any nested conversions
      if ("children" in child && (child.type === "FRAME" || child.type === "GROUP")) {
        console.log("[convertToAutoLayout] Recursing into NONE-direction child:", child.name);
        convertToAutoLayout(child as FrameNode | GroupNode, specMap, idChanges);
      }
      continue;
    }

    // Handle Groups - convert to Frame first
    if (child.type === "GROUP") {
      const group = child as GroupNode;
      const oldId = group.id;

      // Capture ALL properties BEFORE any modifications (group becomes stale after children move)
      const groupName = group.name;
      const groupX = group.x;
      const groupY = group.y;
      const groupWidth = group.width;
      const groupHeight = group.height;
      const groupIndex = parent.children.indexOf(group);
      const groupChildren = [...group.children] as SceneNode[];

      console.log("[convertToAutoLayout] Converting GROUP to FRAME:", groupName);
      console.log("[convertToAutoLayout]   Old ID:", oldId);
      console.log("[convertToAutoLayout]   Group index in parent:", groupIndex);
      console.log("[convertToAutoLayout]   Children count:", groupChildren.length);

      const frame = figma.createFrame();
      const newId = frame.id;

      // Track ID change
      idChanges.set(oldId, newId);
      console.log("[convertToAutoLayout]   ID CHANGED:", oldId, "→", newId);

      // Copy basic properties from saved values
      frame.name = groupName;
      frame.x = groupX;
      frame.y = groupY;
      frame.resize(groupWidth, groupHeight);
      frame.fills = []; // Transparent background

      // Move children from group to frame (preserving relative positions)
      // Note: After this loop, the group becomes empty and Figma auto-removes it
      for (const groupChild of groupChildren) {
        // Calculate relative position within group (using saved groupX/Y)
        const relX = groupChild.x - groupX;
        const relY = groupChild.y - groupY;

        frame.appendChild(groupChild);

        // Restore relative position
        groupChild.x = relX;
        groupChild.y = relY;
      }

      // Replace group with frame in parent
      // Safety check: if index is -1, append at end
      if (groupIndex >= 0) {
        parent.insertChild(groupIndex, frame);
      } else {
        console.log("[spec-applicator] Warning: group not found in parent, appending frame");
        parent.appendChild(frame);
      }

      // Note: Figma automatically removes Groups when they become empty
      // The group is now stale - don't try to access it
      console.log("[spec-applicator] Group converted (auto-removed by Figma):", groupName);

      // Now apply auto-layout to the new frame
      applyAutoLayoutToFrame(frame, layoutDirection);
      console.log("[spec-applicator] Group converted and auto-layout applied:", frame.name);

      // Recurse into the new frame - pass idChanges to track nested conversions
      console.log("[convertToAutoLayout] Recursing into converted frame:", frame.name);
      convertToAutoLayout(frame, specMap, idChanges);
      continue;
    }

    // Handle Frames without auto-layout
    if (child.type === "FRAME") {
      const frame = child as FrameNode;

      // Check if frame contains INSTANCE children - these are product mockups
      // and should keep absolute positioning to preserve decorative elements
      const hasInstanceChild = frame.children.some(c => c.type === "INSTANCE");
      if (hasInstanceChild) {
        console.log("[convertToAutoLayout] SKIP auto-layout for product mockup frame:", frame.name);
        console.log("[convertToAutoLayout]   Contains INSTANCE child - preserving entire subtree");
        // DO NOT recurse into product mockups - their entire internal structure
        // (Container, Groups, decorative elements) must remain absolute-positioned
        continue;
      }

      if (frame.layoutMode === "NONE") {
        console.log("[spec-applicator] Converting FRAME to auto-layout:", frame.name);
        applyAutoLayoutToFrame(frame, layoutDirection);
      } else {
        console.log("[spec-applicator] Frame already has auto-layout:", frame.name, frame.layoutMode);
        // IMPORTANT: Still ensure FILL width even for existing auto-layout frames
        console.log("[spec-applicator]   Current sizing - H:", frame.layoutSizingHorizontal, "V:", frame.layoutSizingVertical);
        frame.layoutSizingHorizontal = "FILL";
        console.log("[spec-applicator]   >>> Set layoutSizingHorizontal to FILL");
      }

      // Recurse into child frames - pass idChanges to track nested conversions
      console.log("[convertToAutoLayout] Recursing into frame:", frame.name);
      convertToAutoLayout(frame, specMap, idChanges);
    }
  }

  // Return the accumulated ID changes
  console.log("[convertToAutoLayout] Returning", idChanges.size, "ID changes");
  return idChanges;
}

/**
 * Apply auto-layout configuration to a frame.
 */
function applyAutoLayoutToFrame(
  frame: FrameNode,
  direction: "VERTICAL" | "HORIZONTAL"
): void {
  console.log("[spec-applicator] applyAutoLayoutToFrame:", frame.name, "direction:", direction);

  frame.layoutMode = direction;
  frame.primaryAxisAlignItems = "MIN";
  frame.counterAxisAlignItems = "MIN";
  frame.itemSpacing = 0; // No gap by default - preserve original spacing
  frame.paddingTop = 0;
  frame.paddingRight = 0;
  frame.paddingBottom = 0;
  frame.paddingLeft = 0;

  // Use FILL for horizontal to stretch to parent width, HUG for vertical to adapt to content
  frame.layoutSizingHorizontal = "FILL";
  frame.layoutSizingVertical = "HUG";

  console.log("[spec-applicator] Auto-layout applied to:", frame.name, "(width: FILL, height: HUG)");
}

/**
 * Convert our sizing mode enum to Figma's expected values.
 */
function sizingModeToFigma(mode: NodeSpec["widthSizing"]): "FILL" | "HUG" | "FIXED" {
  switch (mode) {
    case "FILL":
      return "FILL";
    case "HUG":
      return "HUG";
    case "FIXED":
      return "FIXED";
    default:
      console.log("[spec-applicator] Unknown sizing mode:", mode, "- defaulting to HUG");
      return "HUG";
  }
}

/**
 * Get or create the dedicated TikTok outputs page.
 * This keeps generated variants organized in one place.
 */
function getOrCreateOutputPage(): PageNode {
  const pageName = "TikTok Outputs";
  console.log("[spec-applicator] Looking for output page:", pageName);

  // Find existing page
  let page = figma.root.children.find(p => p.name === pageName) as PageNode | undefined;

  // Create if doesn't exist
  if (!page) {
    console.log("[spec-applicator] Output page not found, creating new page");
    page = figma.createPage();
    page.name = pageName;
    console.log("[spec-applicator] Created output page:", pageName, "id:", page.id);
  } else {
    console.log("[spec-applicator] Found existing output page, id:", page.id);
  }

  return page;
}

/**
 * Calculate the next Y position for stacking variants vertically.
 * Returns 0 if page is empty, otherwise the bottom of the lowest frame + gap.
 */
function getNextYPosition(page: PageNode): number {
  console.log("[spec-applicator] Calculating next Y position, children count:", page.children.length);

  if (page.children.length === 0) {
    console.log("[spec-applicator] Page is empty, starting at Y=0");
    return 0;
  }

  // Find the bottom-most frame
  let maxY = 0;
  for (const child of page.children) {
    const bottom = child.y + child.height;
    if (bottom > maxY) {
      maxY = bottom;
      console.log("[spec-applicator] New max bottom:", bottom, "from node:", child.name);
    }
  }

  const nextY = maxY + 100; // 100px gap between outputs
  console.log("[spec-applicator] Next Y position:", nextY);
  return nextY;
}

/**
 * Check if a node is inside a component instance (i.e., one of its ancestors is an INSTANCE).
 * Nodes inside instances are part of the component's frozen structure and should NOT be modified.
 */
function isInsideComponentInstance(node: SceneNode): boolean {
  let current: BaseNode | null = node.parent;
  while (current) {
    if ("type" in current) {
      if ((current as SceneNode).type === "INSTANCE") {
        console.log(`[isInsideComponentInstance] Node ${node.name} (${node.id}) is inside instance ${current.name}`);
        return true;
      }
      if ((current as SceneNode).type === "COMPONENT") {
        console.log(`[isInsideComponentInstance] Node ${node.name} (${node.id}) is inside component ${current.name}`);
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/**
 * Build a map of ALL nodes in the tree by ID.
 * Also detects and logs component instances to help debug component separation issues.
 */
function buildNodeMap(parent: FrameNode | GroupNode): Map<string, SceneNode> {
  const map = new Map<string, SceneNode>();
  const instanceNodes: string[] = [];
  const componentNodes: string[] = [];

  function walk(node: SceneNode, insideInstance: boolean = false): void {
    map.set(node.id, node);

    // Track instances and components for debugging
    if (node.type === "INSTANCE") {
      instanceNodes.push(`${node.name} (${node.id})`);
      insideInstance = true; // Children are inside this instance
    }
    if (node.type === "COMPONENT") {
      componentNodes.push(`${node.name} (${node.id})`);
    }

    // If we're inside an instance, log the child (helps debug component separation)
    if (insideInstance && node.type !== "INSTANCE") {
      console.log(`[buildNodeMap] Instance child: ${node.name} (${node.id}) - type: ${node.type}`);
    }

    if ("children" in node) {
      for (const child of (node as FrameNode | GroupNode).children) {
        walk(child, insideInstance);
      }
    }
  }

  for (const child of parent.children) {
    walk(child, false);
  }

  if (instanceNodes.length > 0) {
    console.log("[buildNodeMap] Found INSTANCE nodes:", instanceNodes.join(", "));
  }
  if (componentNodes.length > 0) {
    console.log("[buildNodeMap] Found COMPONENT nodes:", componentNodes.join(", "));
  }

  return map;
}

/**
 * Apply semantic grouping to reorder and control visibility of elements.
 *
 * This function:
 * 1. Sorts groups by their order values
 * 2. Applies group-level visibility (hides all nodes in hidden groups)
 * 3. Reorders frame direct children so grouped elements stay together
 * 4. Nested nodes get visibility applied but aren't reordered at root level
 *
 * @param frame - The TikTok variant frame to modify
 * @param groups - Semantic groups from the AI
 * @param specMap - Map of individual node specs for fallback
 * @returns Map of node ID to group for downstream processing
 */
function applySemanticGrouping(
  frame: FrameNode,
  groups: SemanticGroup[],
  specMap: Map<string, NodeSpec>
): Map<string, SemanticGroup> {
  console.log("[applySemanticGrouping] Starting with", groups.length, "groups");

  // Build complete node map for the entire tree
  const allNodesMap = buildNodeMap(frame);
  console.log("[applySemanticGrouping] Built node map with", allNodesMap.size, "nodes");

  // Build direct children map for reordering
  const directChildMap = new Map<string, SceneNode>();
  for (const child of frame.children) {
    directChildMap.set(child.id, child);
  }
  console.log("[applySemanticGrouping] Direct children:", directChildMap.size);

  // Build node-to-group lookup, but SKIP nodes inside component instances
  const nodeToGroup = new Map<string, SemanticGroup>();
  const skippedComponentNodes: string[] = [];

  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      const node = allNodesMap.get(nodeId);
      const isDirect = directChildMap.has(nodeId);

      // CRITICAL: Skip nodes that are inside component instances
      // These are part of the component's frozen structure and should NOT be manipulated
      if (node && isInsideComponentInstance(node)) {
        skippedComponentNodes.push(`${node.name} (${nodeId})`);
        console.log(`[applySemanticGrouping] SKIPPING node inside component: ${node.name} (${nodeId})`);
        continue;
      }

      nodeToGroup.set(nodeId, group);
      console.log(`[applySemanticGrouping] Mapped node ${nodeId} (${node?.name ?? "NOT FOUND"}) to group ${group.groupId} (${group.role}) - direct: ${isDirect}`);
    }
  }

  if (skippedComponentNodes.length > 0) {
    console.log(`[applySemanticGrouping] PROTECTED ${skippedComponentNodes.length} nodes inside components:`, skippedComponentNodes.join(", "));
  }

  // Sort groups by order (lower = first/top)
  const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
  console.log("[applySemanticGrouping] Sorted groups:", sortedGroups.map(g => `${g.role}:${g.order}`).join(", "));

  // Build flat ordered list of node IDs from visible groups
  // AND apply visibility to all nodes (including nested)
  // CRITICAL: Skip nodes inside component instances
  const orderedNodeIds: string[] = [];
  for (const group of sortedGroups) {
    if (group.visible) {
      console.log(`[applySemanticGrouping] Group "${group.groupId}" (${group.role}) visible - nodes:`, group.nodeIds);

      for (const nodeId of group.nodeIds) {
        const node = allNodesMap.get(nodeId);

        // Skip nodes inside components - they're frozen
        if (node && isInsideComponentInstance(node)) {
          console.log(`[applySemanticGrouping] SKIP visibility for component child: ${node.name} (${nodeId})`);
          continue;
        }

        orderedNodeIds.push(nodeId);

        // Ensure visible nodes are actually visible
        if (node) {
          node.visible = true;
        }
      }
    } else {
      console.log(`[applySemanticGrouping] Group "${group.groupId}" (${group.role}) hidden - hiding nodes:`, group.nodeIds);

      // Hide all nodes in this group (works for nested nodes too)
      for (const nodeId of group.nodeIds) {
        const node = allNodesMap.get(nodeId);

        // Skip nodes inside components - they're frozen
        if (node && isInsideComponentInstance(node)) {
          console.log(`[applySemanticGrouping] SKIP visibility for component child: ${node.name} (${nodeId})`);
          continue;
        }

        if (node) {
          node.visible = false;
          console.log(`[applySemanticGrouping] Hidden: ${node.name} (${nodeId})`);
        }
      }
    }
  }

  console.log("[applySemanticGrouping] Ordered node IDs:", orderedNodeIds);

  // Reorder DIRECT children based on orderedNodeIds
  // Nodes not in any group stay at the end in their original order
  const reorderedChildren: SceneNode[] = [];
  const usedIds = new Set<string>();

  // First, add direct children in group order
  for (const nodeId of orderedNodeIds) {
    const child = directChildMap.get(nodeId);
    if (child) {
      reorderedChildren.push(child);
      usedIds.add(nodeId);
      console.log(`[applySemanticGrouping] Ordered (direct): ${child.name} (${nodeId})`);
    } else {
      // Node exists but is nested - can't reorder at root level
      const nestedNode = allNodesMap.get(nodeId);
      if (nestedNode) {
        console.log(`[applySemanticGrouping] Skipping nested node (can't reorder at root): ${nestedNode.name} (${nodeId})`);
      } else {
        console.log(`[applySemanticGrouping] Warning: Node ${nodeId} not found anywhere in tree`);
      }
    }
  }

  // Then add any remaining children not in groups (preserve original order)
  for (const child of frame.children) {
    if (!usedIds.has(child.id)) {
      reorderedChildren.push(child);
      console.log(`[applySemanticGrouping] Ungrouped: ${child.name} (${child.id})`);
    }
  }

  // Apply the new order to Figma
  console.log("[applySemanticGrouping] Applying new order to frame...");
  for (let i = 0; i < reorderedChildren.length; i++) {
    frame.insertChild(i, reorderedChildren[i]);
  }
  console.log("[applySemanticGrouping] Reordering complete");

  return nodeToGroup;
}

/**
 * Apply absolute positioning to nodes that specify positioning: "ABSOLUTE".
 * This removes nodes from auto-layout flow and places them at specific x/y coordinates.
 *
 * POSITIONING MODES:
 * - UNIFORM_FIXED: Scale positions uniformly, keep element sizes (default)
 * - UNIFORM_SCALED: Scale positions AND dimensions uniformly (preserves edge gaps but distorts components)
 * - AI_DETERMINED: Use AI-specified x/y coordinates directly
 *
 * Must be called AFTER auto-layout is set up (nodes need to be in an auto-layout container
 * for layoutPositioning: "ABSOLUTE" to work).
 *
 * @param frame - The TikTok variant frame to process
 * @param specMap - Map of node specs
 * @param originalPositions - Original positions captured before resize
 * @param originalWidth - Original frame width before resize
 * @param originalHeight - Original frame height before resize
 * @param mode - Positioning strategy to use
 */
function applyAbsolutePositioning(
  frame: FrameNode,
  specMap: Map<string, NodeSpec>,
  originalPositions: Map<string, OriginalPosition>,
  originalWidth: number,
  originalHeight: number,
  mode: PositioningMode = "HYBRID",
  semanticGroups: SemanticGroup[] = []
): void {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log(`║ [applyAbsolutePositioning] MODE: ${mode.padEnd(20)}              ║`);
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log("[applyAbsolutePositioning] Original frame:", originalWidth, "x", originalHeight);
  console.log("[applyAbsolutePositioning] Target frame:", frame.width, "x", frame.height);

  // Calculate scale factors
  const scaleX = frame.width / originalWidth;
  const scaleY = frame.height / originalHeight;

  // Use UNIFORM scaling to preserve relative spacing between elements
  // Using the width scale (scaleX) since it's typically less drastic
  // This maintains the original composition's spatial relationships
  const uniformScale = scaleX;
  console.log("[applyAbsolutePositioning] Scale factors - X:", scaleX.toFixed(3), "Y:", scaleY.toFixed(3));
  console.log("[applyAbsolutePositioning] Using UNIFORM scale:", uniformScale.toFixed(3), "(preserves spacing)");

  // Build node-to-group lookup for HYBRID mode
  const nodeToGroup = new Map<string, SemanticGroup>();
  for (const group of semanticGroups) {
    for (const nodeId of group.nodeIds) {
      nodeToGroup.set(nodeId, group);
    }
  }
  console.log("[applyAbsolutePositioning] Built nodeToGroup map with", nodeToGroup.size, "entries");
  if (mode === "HYBRID") {
    const preserveSpacingGroups = semanticGroups.filter(g => g.preserveSpacing).map(g => g.groupId);
    console.log("[applyAbsolutePositioning] Groups with preserveSpacing:", preserveSpacingGroups.length > 0 ? preserveSpacingGroups.join(", ") : "none");
  }

  // Build complete node map for the entire tree
  const allNodesMap = buildNodeMap(frame);
  console.log("[applyAbsolutePositioning] Built node map with", allNodesMap.size, "nodes");

  // ============================================
  // PASS 1: Collect ALL visible direct children for positioning
  // ============================================
  // Iterate over direct children of the root frame (not just spec-marked ABSOLUTE nodes).
  // This ensures modes A-H produce distinct layouts by positioning all top-level elements.
  const absoluteNodes: Array<{ nodeId: string; spec: NodeSpec | undefined; node: SceneNode; originalPos: OriginalPosition }> = [];
  let sumOriginalY = 0;
  let sumOriginalHeight = 0;
  let nodeCount = 0;

  for (const child of frame.children) {
    if (!child.visible) continue;
    if (isInsideComponentInstance(child)) continue;
    if (!("layoutPositioning" in child)) continue;

    const originalPos = originalPositions.get(child.id);
    if (!originalPos) {
      console.log(`[applyAbsolutePositioning] SKIP ${child.name}: no original position recorded`);
      continue;
    }

    const spec = specMap.get(child.id); // May be undefined — that's fine
    absoluteNodes.push({ nodeId: child.id, spec, node: child, originalPos });

    // Accumulate for centroid calculation
    sumOriginalY += originalPos.y + originalPos.height / 2; // center Y of each element
    sumOriginalHeight += originalPos.height;
    nodeCount++;
  }

  console.log("┌─────────────────────────────────────────────────────────────────┐");
  console.log("│ ORIGINAL ELEMENT BOUNDS (before any transformation)            │");
  console.log("└─────────────────────────────────────────────────────────────────┘");
  for (const { node, originalPos } of absoluteNodes) {
    console.log(`[ORIGINAL] ${node.name}:`);
    console.log(`  Position: (${originalPos.x.toFixed(1)}, ${originalPos.y.toFixed(1)})`);
    console.log(`  Size: ${originalPos.width.toFixed(1)} x ${originalPos.height.toFixed(1)}`);
    console.log(`  Bounds: Left=${originalPos.x.toFixed(1)}, Right=${(originalPos.x + originalPos.width).toFixed(1)}`);
    console.log(`          Top=${originalPos.y.toFixed(1)}, Bottom=${(originalPos.y + originalPos.height).toFixed(1)}`);
    console.log(`  Center: (${(originalPos.x + originalPos.width / 2).toFixed(1)}, ${(originalPos.y + originalPos.height / 2).toFixed(1)})`);
  }

  // Calculate ORIGINAL edge-to-edge gaps between ALL pairs of elements
  console.log("┌─────────────────────────────────────────────────────────────────┐");
  console.log("│ ORIGINAL EDGE-TO-EDGE GAPS (visual spacing between elements)   │");
  console.log("└─────────────────────────────────────────────────────────────────┘");
  for (let i = 0; i < absoluteNodes.length; i++) {
    for (let j = i + 1; j < absoluteNodes.length; j++) {
      const a = absoluteNodes[i];
      const b = absoluteNodes[j];

      // Calculate horizontal gap (negative = overlap)
      const aRight = a.originalPos.x + a.originalPos.width;
      const bRight = b.originalPos.x + b.originalPos.width;
      const horizontalGap = Math.max(b.originalPos.x - aRight, a.originalPos.x - bRight);

      // Calculate vertical gap (negative = overlap)
      const aBottom = a.originalPos.y + a.originalPos.height;
      const bBottom = b.originalPos.y + b.originalPos.height;
      const verticalGap = Math.max(b.originalPos.y - aBottom, a.originalPos.y - bBottom);

      // Calculate center-to-center distance
      const aCenterX = a.originalPos.x + a.originalPos.width / 2;
      const aCenterY = a.originalPos.y + a.originalPos.height / 2;
      const bCenterX = b.originalPos.x + b.originalPos.width / 2;
      const bCenterY = b.originalPos.y + b.originalPos.height / 2;
      const centerDeltaX = bCenterX - aCenterX;
      const centerDeltaY = bCenterY - aCenterY;

      console.log(`[ORIGINAL GAP] ${a.node.name} <-> ${b.node.name}:`);
      console.log(`  Horizontal edge gap: ${horizontalGap.toFixed(1)}px ${horizontalGap < 0 ? "(OVERLAP)" : ""}`);
      console.log(`  Vertical edge gap: ${verticalGap.toFixed(1)}px ${verticalGap < 0 ? "(OVERLAP)" : ""}`);
      console.log(`  Center-to-center: ΔX=${centerDeltaX.toFixed(1)}, ΔY=${centerDeltaY.toFixed(1)}`);
    }
  }

  // Calculate composition bounding box BEFORE transformation
  let origMinX = Infinity, origMaxX = -Infinity;
  let origMinY = Infinity, origMaxY = -Infinity;
  for (const { originalPos } of absoluteNodes) {
    origMinX = Math.min(origMinX, originalPos.x);
    origMaxX = Math.max(origMaxX, originalPos.x + originalPos.width);
    origMinY = Math.min(origMinY, originalPos.y);
    origMaxY = Math.max(origMaxY, originalPos.y + originalPos.height);
  }
  console.log("┌─────────────────────────────────────────────────────────────────┐");
  console.log("│ ORIGINAL COMPOSITION BOUNDING BOX                              │");
  console.log("└─────────────────────────────────────────────────────────────────┘");
  console.log(`  Position: (${origMinX.toFixed(1)}, ${origMinY.toFixed(1)})`);
  console.log(`  Size: ${(origMaxX - origMinX).toFixed(1)} x ${(origMaxY - origMinY).toFixed(1)}`);
  console.log(`  Center: (${((origMinX + origMaxX) / 2).toFixed(1)}, ${((origMinY + origMaxY) / 2).toFixed(1)})`);

  // Calculate vertical offset to maintain relative vertical position
  let yOffset = 0;
  // Also calculate X centroid for horizontal centering
  let sumOriginalX = 0;
  for (const { originalPos } of absoluteNodes) {
    sumOriginalX += originalPos.x + originalPos.width / 2;
  }

  // Calculate X offset for centering (used in PRESERVE_SPACING mode)
  let xOffset = 0;

  if (nodeCount > 0) {
    // Original centroid Y position (average center of all elements)
    const originalCentroidY = sumOriginalY / nodeCount;
    // What percentage down the frame was the centroid?
    const relativeVerticalPosition = originalCentroidY / originalHeight;
    // Where should the centroid be in the new frame?
    const targetCentroidY = relativeVerticalPosition * frame.height;
    // Where would the centroid be with just uniform scaling?
    const scaledCentroidY = originalCentroidY * uniformScale;
    // The offset needed to move from scaled position to target position
    yOffset = targetCentroidY - scaledCentroidY;

    // Calculate X centroid and offset to center composition horizontally
    const originalCentroidX = sumOriginalX / nodeCount;
    // Target: center of new frame
    const targetCentroidX = frame.width / 2;
    // X offset to center the composition (keep original X positions, just shift)
    xOffset = targetCentroidX - originalCentroidX;

    console.log("┌─────────────────────────────────────────────────────────────────┐");
    console.log("│ CENTROID & OFFSET CALCULATION                                  │");
    console.log("└─────────────────────────────────────────────────────────────────┘");
    console.log(`  Original centroid: (${originalCentroidX.toFixed(1)}, ${originalCentroidY.toFixed(1)})`);
    console.log(`  Target centroid X (center of new frame): ${targetCentroidX.toFixed(1)}`);
    console.log(`  >>> Initial X offset to center: ${xOffset.toFixed(1)}px`);

    // ============================================
    // EDGE CLAMPING & TIKTOK SAFETY ZONES
    // ============================================
    // TikTok safe zones:
    // - TOP 8% (0-154px): Danger zone (status bar, TikTok UI)
    // - BOTTOM 35% (1248-1920px): Danger zone (buttons, captions, engagement UI)
    // - SAFE ZONE: 154-1248px vertically, 60px padding horizontally
    const EDGE_PADDING = 60; // Horizontal padding (40-80px range)
    const TIKTOK_TOP_DANGER = 154; // Top 8% danger zone
    const TIKTOK_BOTTOM_SAFE = 1248; // Bottom of safe zone (above 35% danger)

    // Calculate where the composition bounding box would be after applying xOffset
    const projectedMinX = origMinX + xOffset;
    const projectedMaxX = origMaxX + xOffset;
    const compositionWidth = origMaxX - origMinX;

    console.log("┌─────────────────────────────────────────────────────────────────┐");
    console.log("│ TIKTOK SAFETY ZONES & EDGE CLAMPING                             │");
    console.log("└─────────────────────────────────────────────────────────────────┘");
    console.log(`  Horizontal padding: ${EDGE_PADDING}px`);
    console.log(`  Vertical safe zone: ${TIKTOK_TOP_DANGER}px - ${TIKTOK_BOTTOM_SAFE}px`);
    console.log(`  Projected X bounds after offset: [${projectedMinX.toFixed(1)}, ${projectedMaxX.toFixed(1)}]`);
    console.log(`  Composition width: ${compositionWidth.toFixed(1)}px, Frame width: ${frame.width}px`);

    // Check if composition fits within frame (with padding)
    const availableWidth = frame.width - (2 * EDGE_PADDING);

    if (compositionWidth > availableWidth) {
      // Composition is wider than frame - center it and allow bleed
      // This preserves spacing but accepts some elements will be cut off
      const compositionCenterX = (origMinX + origMaxX) / 2;
      xOffset = (frame.width / 2) - compositionCenterX;
      console.log(`  ⚠️ Composition wider than frame (${compositionWidth.toFixed(0)}px > ${availableWidth.toFixed(0)}px)!`);
      console.log(`  >>> Centering with controlled bleed`);
      console.log(`  >>> Adjusted X offset: ${xOffset.toFixed(1)}px`);
    } else {
      // Composition fits - clamp to prevent going off-screen
      if (projectedMinX < EDGE_PADDING) {
        // Left edge would be cut off - shift right
        const adjustment = EDGE_PADDING - projectedMinX;
        xOffset += adjustment;
        console.log(`  ⚠️ Left edge at ${projectedMinX.toFixed(1)}px < ${EDGE_PADDING}px padding`);
        console.log(`  >>> Shifting right by ${adjustment.toFixed(1)}px`);
        console.log(`  >>> Adjusted X offset: ${xOffset.toFixed(1)}px`);
      } else if (projectedMaxX > frame.width - EDGE_PADDING) {
        // Right edge would be cut off - shift left
        const adjustment = projectedMaxX - (frame.width - EDGE_PADDING);
        xOffset -= adjustment;
        console.log(`  ⚠️ Right edge at ${projectedMaxX.toFixed(1)}px > ${frame.width - EDGE_PADDING}px`);
        console.log(`  >>> Shifting left by ${adjustment.toFixed(1)}px`);
        console.log(`  >>> Adjusted X offset: ${xOffset.toFixed(1)}px`);
      } else {
        console.log(`  ✓ Horizontal bounds OK: [${projectedMinX.toFixed(1)}, ${projectedMaxX.toFixed(1)}]`);
      }
    }

    // Vertical safety zone adjustment for Y offset
    // Ensure composition centroid stays within TikTok safe zone
    const projectedCentroidY = scaledCentroidY + yOffset;
    if (projectedCentroidY < TIKTOK_TOP_DANGER + 100) {
      // Centroid too close to top danger zone - push down
      const adjustment = (TIKTOK_TOP_DANGER + 100) - projectedCentroidY;
      yOffset += adjustment;
      console.log(`  ⚠️ Centroid at ${projectedCentroidY.toFixed(1)}px too close to top danger zone`);
      console.log(`  >>> Pushing down by ${adjustment.toFixed(1)}px`);
    } else if (projectedCentroidY > TIKTOK_BOTTOM_SAFE - 100) {
      // Centroid too close to bottom danger zone - push up
      const adjustment = projectedCentroidY - (TIKTOK_BOTTOM_SAFE - 100);
      yOffset -= adjustment;
      console.log(`  ⚠️ Centroid at ${projectedCentroidY.toFixed(1)}px too close to bottom danger zone`);
      console.log(`  >>> Pushing up by ${adjustment.toFixed(1)}px`);
    } else {
      console.log(`  ✓ Vertical centroid OK at ${projectedCentroidY.toFixed(1)}px (safe: ${TIKTOK_TOP_DANGER + 100}-${TIKTOK_BOTTOM_SAFE - 100})`);
    }

    console.log(`  Relative Y position: ${(relativeVerticalPosition * 100).toFixed(1)}% down frame`);
    console.log(`  Target centroid Y (in new frame): ${targetCentroidY.toFixed(1)}`);
    console.log(`  Scaled centroid Y (uniform only): ${scaledCentroidY.toFixed(1)}`);
    console.log(`  >>> Y offset needed: ${yOffset.toFixed(1)}px`);
  }

  // ============================================
  // PASS 2: Apply positioning with uniform scale + offset
  // ============================================
  console.log("┌─────────────────────────────────────────────────────────────────┐");
  console.log("│ APPLYING TRANSFORMATIONS                                        │");
  console.log("└─────────────────────────────────────────────────────────────────┘");

  if (mode === "HYBRID") {
    console.log("┌─────────────────────────────────────────────────────────────────┐");
    console.log("│ HYBRID MODE: Per-Element Strategy Selection                     │");
    console.log("│ - preserveSpacing groups → PRESERVE_SPACING logic               │");
    console.log("│ - AI coordinates available → AI_DETERMINED logic                │");
    console.log("│ - Otherwise → UNIFORM_FALLBACK                                  │");
    console.log("└─────────────────────────────────────────────────────────────────┘");
  }

  const finalPositions: Array<{ name: string; x: number; y: number; width: number; height: number }> = [];

  for (const { nodeId, spec, node, originalPos } of absoluteNodes) {
    const nodeName = spec?.nodeName ?? node.name;
    console.log(`[TRANSFORM] ${nodeName} (id: ${nodeId}):`);

    // Set to absolute positioning (breaks out of auto-layout flow)
    const targetNode = node as SceneNode & { layoutPositioning: "AUTO" | "ABSOLUTE" };
    targetNode.layoutPositioning = "ABSOLUTE";

    // Reset dimensions to original (auto-layout FILL may have stretched them)
    if ("resize" in node && typeof (node as { resize: unknown }).resize === "function") {
      const resizableNode = node as SceneNode & { resize: (width: number, height: number) => void };
      resizableNode.resize(originalPos.width, originalPos.height);
      console.log(`  Reset dimensions to original: ${originalPos.width.toFixed(1)} x ${originalPos.height.toFixed(1)}`);
    }

    // Default: center horizontally, scale Y proportionally
    let newX: number = (frame.width - originalPos.width) / 2;
    let newY: number = originalPos.y * uniformScale + yOffset;
    let finalWidth = originalPos.width;
    let finalHeight = originalPos.height;

    // Apply positioning based on mode
    switch (mode) {
      case "PRESERVE_SPACING":
        // KEEP original X positions (preserves horizontal spacing between elements)
        // Just shift horizontally to center the composition in the narrower frame
        // Scale Y by uniformScale + offset to maintain vertical placement
        newX = originalPos.x + xOffset;
        newY = originalPos.y * uniformScale + yOffset;
        console.log(`  [PRESERVE_SPACING] Original X spacing preserved, centered horizontally`);
        console.log(`    Original pos: (${originalPos.x.toFixed(1)}, ${originalPos.y.toFixed(1)})`);
        console.log(`    X: ${originalPos.x.toFixed(1)} + offset ${xOffset.toFixed(1)} = ${newX.toFixed(1)}`);
        console.log(`    Y: ${originalPos.y.toFixed(1)} * ${uniformScale.toFixed(3)} + ${yOffset.toFixed(1)} = ${newY.toFixed(1)}`);
        console.log(`    >>> Final:    (${newX.toFixed(1)}, ${newY.toFixed(1)})`);
        break;

      case "UNIFORM_SCALED":
        // Scale BOTH positions AND dimensions uniformly
        newX = originalPos.x * uniformScale;
        newY = originalPos.y * uniformScale + yOffset;
        finalWidth = originalPos.width * uniformScale;
        finalHeight = originalPos.height * uniformScale;

        // Apply dimension scaling
        if ("resize" in node && typeof (node as { resize: unknown }).resize === "function") {
          const resizableNode = node as SceneNode & { resize: (width: number, height: number) => void };
          resizableNode.resize(finalWidth, finalHeight);
        }

        console.log(`  [UNIFORM_SCALED] Positions AND dimensions scaled ${uniformScale.toFixed(3)}x`);
        console.log(`    Original: (${originalPos.x.toFixed(1)}, ${originalPos.y.toFixed(1)}) @ ${originalPos.width.toFixed(1)}x${originalPos.height.toFixed(1)}`);
        console.log(`    Scaled:   (${newX.toFixed(1)}, ${newY.toFixed(1)}) @ ${finalWidth.toFixed(1)}x${finalHeight.toFixed(1)}`);
        break;

      case "AI_DETERMINED":
        // Use AI-specified coordinates if available, otherwise use center positioning
        if (spec?.x !== undefined && spec?.y !== undefined) {
          newX = spec.x;
          newY = spec.y;
          console.log(`  [AI_DETERMINED] Using AI coordinates: (${spec.x}, ${spec.y})`);
        } else {
          // Fallback: center horizontally, position at original Y percentage
          newX = (frame.width - originalPos.width) / 2;
          const yPercentage = originalPos.y / originalHeight;
          newY = yPercentage * frame.height;
          console.log(`  [AI_DETERMINED] No AI coords, centering: (${newX.toFixed(1)}, ${newY.toFixed(1)})`);
        }
        break;

      case "HYBRID":
        // Per-element strategy based on semantic group's preserveSpacing flag
        const group = nodeToGroup.get(nodeId);
        let strategyUsed: string;

        console.log(`  [HYBRID] Checking strategy for ${nodeName}:`);
        console.log(`    Group: ${group?.groupId ?? "none"}`);
        console.log(`    Role: ${group?.role ?? "ungrouped"}`);
        console.log(`    preserveSpacing: ${group?.preserveSpacing ?? false}`);
        console.log(`    AI coords available: ${spec?.x !== undefined && spec?.y !== undefined}`);

        if (group?.preserveSpacing) {
          // Use PRESERVE_SPACING logic: keep original X, center horizontally, scale Y
          newX = originalPos.x + xOffset;
          newY = originalPos.y * uniformScale + yOffset;
          strategyUsed = "PRESERVE_SPACING (group has preserveSpacing: true)";
          console.log(`    >>> Strategy: PRESERVE_SPACING`);
          console.log(`    Original pos: (${originalPos.x.toFixed(1)}, ${originalPos.y.toFixed(1)})`);
          console.log(`    X: ${originalPos.x.toFixed(1)} + offset ${xOffset.toFixed(1)} = ${newX.toFixed(1)}`);
          console.log(`    Y: ${originalPos.y.toFixed(1)} * ${uniformScale.toFixed(3)} + ${yOffset.toFixed(1)} = ${newY.toFixed(1)}`);
        } else if (spec?.x !== undefined && spec?.y !== undefined) {
          // Use AI_DETERMINED logic: AI-specified coordinates
          newX = spec.x;
          newY = spec.y;
          strategyUsed = "AI_DETERMINED (has x/y coordinates)";
          console.log(`    >>> Strategy: AI_DETERMINED`);
          console.log(`    Using AI coordinates: (${spec.x}, ${spec.y})`);
        } else {
          // Fallback: uniform scaling with offset (centered)
          newX = originalPos.x * uniformScale + (frame.width - originalWidth * uniformScale) / 2;
          newY = originalPos.y * uniformScale + yOffset;
          strategyUsed = "UNIFORM_FALLBACK (no group or AI coords)";
          console.log(`    >>> Strategy: UNIFORM_FALLBACK`);
          console.log(`    Original pos: (${originalPos.x.toFixed(1)}, ${originalPos.y.toFixed(1)})`);
          console.log(`    Scaled + centered: (${newX.toFixed(1)}, ${newY.toFixed(1)})`);
        }

        console.log(`  [HYBRID] ${nodeName}: ${strategyUsed}`);
        break;

      case "AD_X_PRESERVE_Y_AI":
        // X from Mode A (preserve spacing + offset), Y from Mode D (AI coords)
        newX = originalPos.x + xOffset;
        if (spec?.y !== undefined) {
          newY = spec.y;
          console.log(`  [AD_X_PRESERVE_Y_AI] X: preserve spacing, Y: AI`);
          console.log(`    X: ${originalPos.x.toFixed(1)} + ${xOffset.toFixed(1)} = ${newX.toFixed(1)}`);
          console.log(`    Y: AI specified = ${newY.toFixed(1)}`);
        } else {
          // Fallback if no AI Y coord
          newY = originalPos.y * uniformScale + yOffset;
          console.log(`  [AD_X_PRESERVE_Y_AI] X: preserve spacing, Y: scaled (no AI coord)`);
        }
        break;

      case "AD_X_AI_Y_PRESERVE":
        // X from Mode D (AI coords), Y from Mode A (scaled + offset)
        newY = originalPos.y * uniformScale + yOffset;
        if (spec?.x !== undefined) {
          newX = spec.x;
          console.log(`  [AD_X_AI_Y_PRESERVE] X: AI, Y: preserve spacing`);
          console.log(`    X: AI specified = ${newX.toFixed(1)}`);
          console.log(`    Y: ${originalPos.y.toFixed(1)} * ${uniformScale.toFixed(3)} + ${yOffset.toFixed(1)} = ${newY.toFixed(1)}`);
        } else {
          // Fallback if no AI X coord
          newX = originalPos.x + xOffset;
          console.log(`  [AD_X_AI_Y_PRESERVE] X: preserve (no AI coord), Y: preserve spacing`);
        }
        break;

      case "AD_BLEND_50":
        // 50% blend of Mode A and Mode D positions
        const a50X = originalPos.x + xOffset;
        const a50Y = originalPos.y * uniformScale + yOffset;
        const d50X = spec?.x ?? a50X;
        const d50Y = spec?.y ?? a50Y;
        newX = (a50X + d50X) / 2;
        newY = (a50Y + d50Y) / 2;
        console.log(`  [AD_BLEND_50] 50% A + 50% D blend`);
        console.log(`    A position: (${a50X.toFixed(1)}, ${a50Y.toFixed(1)})`);
        console.log(`    D position: (${d50X.toFixed(1)}, ${d50Y.toFixed(1)})`);
        console.log(`    Blended:    (${newX.toFixed(1)}, ${newY.toFixed(1)})`);
        break;

      case "AD_BLEND_70_30":
        // 70% Mode A + 30% Mode D blend
        const a70X = originalPos.x + xOffset;
        const a70Y = originalPos.y * uniformScale + yOffset;
        const d30X = spec?.x ?? a70X;
        const d30Y = spec?.y ?? a70Y;
        newX = 0.7 * a70X + 0.3 * d30X;
        newY = 0.7 * a70Y + 0.3 * d30Y;
        console.log(`  [AD_BLEND_70_30] 70% A + 30% D blend`);
        console.log(`    A position: (${a70X.toFixed(1)}, ${a70Y.toFixed(1)})`);
        console.log(`    D position: (${d30X.toFixed(1)}, ${d30Y.toFixed(1)})`);
        console.log(`    Blended:    (${newX.toFixed(1)}, ${newY.toFixed(1)})`);
        break;
    }

    node.x = newX;
    node.y = newY;

    // Store final position for gap analysis
    finalPositions.push({
      name: nodeName,
      x: newX,
      y: newY,
      width: finalWidth,
      height: finalHeight
    });

    console.log(`  >>> FINAL: (${newX.toFixed(1)}, ${newY.toFixed(1)}) @ ${finalWidth.toFixed(1)}x${finalHeight.toFixed(1)}`);
  }

  // Calculate FINAL edge-to-edge gaps between ALL pairs of elements
  console.log("┌─────────────────────────────────────────────────────────────────┐");
  console.log("│ FINAL EDGE-TO-EDGE GAPS (after transformation)                  │");
  console.log("└─────────────────────────────────────────────────────────────────┘");
  for (let i = 0; i < finalPositions.length; i++) {
    for (let j = i + 1; j < finalPositions.length; j++) {
      const a = finalPositions[i];
      const b = finalPositions[j];

      // Calculate horizontal gap (negative = overlap)
      const aRight = a.x + a.width;
      const bRight = b.x + b.width;
      const horizontalGap = Math.max(b.x - aRight, a.x - bRight);

      // Calculate vertical gap (negative = overlap)
      const aBottom = a.y + a.height;
      const bBottom = b.y + b.height;
      const verticalGap = Math.max(b.y - aBottom, a.y - bBottom);

      // Calculate center-to-center distance
      const aCenterX = a.x + a.width / 2;
      const aCenterY = a.y + a.height / 2;
      const bCenterX = b.x + b.width / 2;
      const bCenterY = b.y + b.height / 2;
      const centerDeltaX = bCenterX - aCenterX;
      const centerDeltaY = bCenterY - aCenterY;

      console.log(`[FINAL GAP] ${a.name} <-> ${b.name}:`);
      console.log(`  Horizontal edge gap: ${horizontalGap.toFixed(1)}px ${horizontalGap < 0 ? "(OVERLAP)" : ""}`);
      console.log(`  Vertical edge gap: ${verticalGap.toFixed(1)}px ${verticalGap < 0 ? "(OVERLAP)" : ""}`);
      console.log(`  Center-to-center: ΔX=${centerDeltaX.toFixed(1)}, ΔY=${centerDeltaY.toFixed(1)}`);
    }
  }

  // Calculate composition bounding box AFTER transformation
  let finalMinX = Infinity, finalMaxX = -Infinity;
  let finalMinY = Infinity, finalMaxY = -Infinity;
  for (const pos of finalPositions) {
    finalMinX = Math.min(finalMinX, pos.x);
    finalMaxX = Math.max(finalMaxX, pos.x + pos.width);
    finalMinY = Math.min(finalMinY, pos.y);
    finalMaxY = Math.max(finalMaxY, pos.y + pos.height);
  }
  console.log("┌─────────────────────────────────────────────────────────────────┐");
  console.log("│ FINAL COMPOSITION BOUNDING BOX                                  │");
  console.log("└─────────────────────────────────────────────────────────────────┘");
  console.log(`  Position: (${finalMinX.toFixed(1)}, ${finalMinY.toFixed(1)})`);
  console.log(`  Size: ${(finalMaxX - finalMinX).toFixed(1)} x ${(finalMaxY - finalMinY).toFixed(1)}`);
  console.log(`  Center: (${((finalMinX + finalMaxX) / 2).toFixed(1)}, ${((finalMinY + finalMaxY) / 2).toFixed(1)})`);

  // COMPARISON SUMMARY
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║ SPACING COMPARISON SUMMARY                                       ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log(`Original composition size: ${(origMaxX - origMinX).toFixed(1)} x ${(origMaxY - origMinY).toFixed(1)}`);
  console.log(`Final composition size:    ${(finalMaxX - finalMinX).toFixed(1)} x ${(finalMaxY - finalMinY).toFixed(1)}`);
  console.log(`Expected scaled size:      ${((origMaxX - origMinX) * uniformScale).toFixed(1)} x ${((origMaxY - origMinY) * uniformScale).toFixed(1)}`);
  console.log(`Scale applied: ${uniformScale.toFixed(3)}`);

  // Compare gaps
  for (let i = 0; i < absoluteNodes.length; i++) {
    for (let j = i + 1; j < absoluteNodes.length; j++) {
      const a = absoluteNodes[i];
      const b = absoluteNodes[j];
      const aFinal = finalPositions[i];
      const bFinal = finalPositions[j];

      // Original center-to-center
      const origCenterDeltaX = (b.originalPos.x + b.originalPos.width / 2) - (a.originalPos.x + a.originalPos.width / 2);
      const origCenterDeltaY = (b.originalPos.y + b.originalPos.height / 2) - (a.originalPos.y + a.originalPos.height / 2);

      // Final center-to-center
      const finalCenterDeltaX = (bFinal.x + bFinal.width / 2) - (aFinal.x + aFinal.width / 2);
      const finalCenterDeltaY = (bFinal.y + bFinal.height / 2) - (aFinal.y + aFinal.height / 2);

      // Expected (with uniform scale)
      const expectedDeltaX = origCenterDeltaX * uniformScale;
      const expectedDeltaY = origCenterDeltaY * uniformScale;

      console.log(`${a.node.name} <-> ${b.node.name}:`);
      console.log(`  Original ΔX: ${origCenterDeltaX.toFixed(1)} -> Final: ${finalCenterDeltaX.toFixed(1)} (expected: ${expectedDeltaX.toFixed(1)})`);
      console.log(`  Original ΔY: ${origCenterDeltaY.toFixed(1)} -> Final: ${finalCenterDeltaY.toFixed(1)} (expected: ${expectedDeltaY.toFixed(1)})`);

      const deltaXError = Math.abs(finalCenterDeltaX - expectedDeltaX);
      const deltaYError = Math.abs(finalCenterDeltaY - expectedDeltaY);
      if (deltaXError > 1 || deltaYError > 1) {
        console.log(`  ⚠️ SPACING ERROR: ΔX off by ${deltaXError.toFixed(1)}px, ΔY off by ${deltaYError.toFixed(1)}px`);
      } else {
        console.log(`  ✓ Spacing preserved correctly`);
      }
    }
  }

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║ [applyAbsolutePositioning] COMPLETE                              ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
}

/**
 * Apply z-index ordering to control layer stacking.
 * Figma doesn't have a z-index property - we control stacking via insertChild() order.
 * Lower insertChild index = behind, higher index = in front.
 *
 * @param frame - The frame to process
 * @param specMap - Map of node specs
 */
function applyZIndexOrdering(
  frame: FrameNode,
  specMap: Map<string, NodeSpec>
): void {
  console.log("[applyZIndexOrdering] Starting for frame:", frame.name);

  // Collect direct children with zIndex values
  const childrenWithZIndex: Array<{ node: SceneNode; zIndex: number }> = [];
  const childrenWithoutZIndex: SceneNode[] = [];

  for (const child of frame.children) {
    const spec = specMap.get(child.id);
    if (spec?.zIndex !== undefined) {
      childrenWithZIndex.push({ node: child, zIndex: spec.zIndex });
      console.log("[applyZIndexOrdering] Node with zIndex:", child.name, "zIndex:", spec.zIndex);
    } else {
      childrenWithoutZIndex.push(child);
    }
  }

  console.log("[applyZIndexOrdering] Nodes with zIndex:", childrenWithZIndex.length);
  console.log("[applyZIndexOrdering] Nodes without zIndex:", childrenWithoutZIndex.length);

  // If no zIndex values specified, skip reordering
  if (childrenWithZIndex.length === 0) {
    console.log("[applyZIndexOrdering] No zIndex values specified, skipping");
    // Still recurse into child frames
    for (const child of frame.children) {
      if (child.type === "FRAME") {
        applyZIndexOrdering(child as FrameNode, specMap);
      }
    }
    return;
  }

  // Sort by zIndex (lower = behind/first, higher = in front/last)
  childrenWithZIndex.sort((a, b) => a.zIndex - b.zIndex);
  console.log("[applyZIndexOrdering] Sorted order:", childrenWithZIndex.map(c => `${c.node.name}:${c.zIndex}`).join(", "));

  // Build final order:
  // 1. Nodes without zIndex maintain relative position at the back
  // 2. Nodes with zIndex are stacked in order on top
  const finalOrder: SceneNode[] = [...childrenWithoutZIndex, ...childrenWithZIndex.map(c => c.node)];

  console.log("[applyZIndexOrdering] Final stacking order (back to front):");
  for (let i = 0; i < finalOrder.length; i++) {
    console.log(`[applyZIndexOrdering]   ${i}: ${finalOrder[i].name}`);
  }

  // Apply the new stacking order using insertChild
  for (let i = 0; i < finalOrder.length; i++) {
    frame.insertChild(i, finalOrder[i]);
  }
  console.log("[applyZIndexOrdering] Reordering complete for frame:", frame.name);

  // Recurse into child frames
  for (const child of frame.children) {
    if (child.type === "FRAME") {
      applyZIndexOrdering(child as FrameNode, specMap);
    }
  }
}

// ============================================
// Phase 2: Advanced Transforms
// ============================================

/**
 * Apply rotation transforms to nodes.
 * Figma's rotation is in degrees, positive = counterclockwise.
 *
 * @param frame - The TikTok variant frame to process
 * @param specMap - Map of node specs
 */
function applyRotation(
  frame: FrameNode,
  specMap: Map<string, NodeSpec>
): void {
  console.log("[applyRotation] Starting...");

  // Build complete node map for the entire tree
  const allNodesMap = buildNodeMap(frame);
  console.log("[applyRotation] Built node map with", allNodesMap.size, "nodes");

  // Find all nodes with rotation specified
  let rotationCount = 0;
  for (const [nodeId, spec] of specMap) {
    if (spec.rotation === undefined || spec.rotation === 0) {
      continue;
    }

    rotationCount++;
    const node = allNodesMap.get(nodeId);

    if (!node) {
      console.log("[applyRotation] WARNING: Node not found:", nodeId, spec.nodeName);
      continue;
    }

    console.log("[applyRotation] Processing node:", spec.nodeName, "id:", nodeId);
    console.log("[applyRotation]   Requested rotation:", spec.rotation, "degrees");

    // CRITICAL: Skip nodes inside component instances - they're frozen
    if (isInsideComponentInstance(node)) {
      console.log("[applyRotation]   SKIP - inside component instance");
      continue;
    }

    // Check if node supports rotation
    if (!("rotation" in node)) {
      console.log("[applyRotation]   SKIP - node doesn't support rotation");
      continue;
    }

    // Store original position for logging
    const originalRotation = (node as SceneNode & { rotation: number }).rotation;
    console.log("[applyRotation]   Original rotation:", originalRotation, "degrees");

    // Apply rotation
    (node as SceneNode & { rotation: number }).rotation = spec.rotation;
    console.log("[applyRotation]   Applied rotation:", spec.rotation, "degrees");
    console.log("[applyRotation]   Final rotation:", (node as SceneNode & { rotation: number }).rotation, "degrees");
  }

  console.log("[applyRotation] Complete. Processed", rotationCount, "nodes with rotation");
}

/**
 * Apply aspect-locked scaling to nodes.
 * Scales elements to target dimensions while maintaining original proportions.
 *
 * @param frame - The TikTok variant frame to process
 * @param specMap - Map of node specs
 */
function applyAspectLockedScaling(
  frame: FrameNode,
  specMap: Map<string, NodeSpec>
): void {
  console.log("[applyAspectLockedScaling] Starting...");

  // Build complete node map for the entire tree
  const allNodesMap = buildNodeMap(frame);
  console.log("[applyAspectLockedScaling] Built node map with", allNodesMap.size, "nodes");

  // Find all nodes with aspect-locked scaling
  let scaleCount = 0;
  for (const [nodeId, spec] of specMap) {
    // Skip if aspectLocked is not set or no target dimensions
    if (!spec.aspectLocked) {
      continue;
    }
    if (spec.targetWidth === undefined && spec.targetHeight === undefined) {
      console.log("[applyAspectLockedScaling] Node", spec.nodeName, "has aspectLocked but no target dimensions, skipping");
      continue;
    }

    scaleCount++;
    const node = allNodesMap.get(nodeId);

    if (!node) {
      console.log("[applyAspectLockedScaling] WARNING: Node not found:", nodeId, spec.nodeName);
      continue;
    }

    console.log("[applyAspectLockedScaling] Processing node:", spec.nodeName, "id:", nodeId);

    // CRITICAL: Skip nodes inside component instances - they're frozen
    if (isInsideComponentInstance(node)) {
      console.log("[applyAspectLockedScaling]   SKIP - inside component instance");
      continue;
    }

    // Check if node supports resize
    if (!("resize" in node)) {
      console.log("[applyAspectLockedScaling]   SKIP - node doesn't support resize");
      continue;
    }

    const resizableNode = node as SceneNode & { resize: (width: number, height: number) => void };
    const originalWidth = node.width;
    const originalHeight = node.height;
    const aspectRatio = originalWidth / originalHeight;

    console.log("[applyAspectLockedScaling]   Original size:", originalWidth, "x", originalHeight);
    console.log("[applyAspectLockedScaling]   Aspect ratio:", aspectRatio.toFixed(4));
    console.log("[applyAspectLockedScaling]   Target width:", spec.targetWidth ?? "not set");
    console.log("[applyAspectLockedScaling]   Target height:", spec.targetHeight ?? "not set");

    let newWidth: number;
    let newHeight: number;

    if (spec.targetWidth !== undefined && spec.targetHeight !== undefined) {
      // Both dimensions specified - scale to fit within bounds (use smaller scale)
      const widthScale = spec.targetWidth / originalWidth;
      const heightScale = spec.targetHeight / originalHeight;
      const scale = Math.min(widthScale, heightScale);
      newWidth = originalWidth * scale;
      newHeight = originalHeight * scale;
      console.log("[applyAspectLockedScaling]   Both dimensions specified, using fit-within scale:", scale.toFixed(4));
    } else if (spec.targetWidth !== undefined) {
      // Only width specified - calculate height from aspect ratio
      newWidth = spec.targetWidth;
      newHeight = spec.targetWidth / aspectRatio;
      console.log("[applyAspectLockedScaling]   Width specified, calculating height from aspect ratio");
    } else {
      // Only height specified - calculate width from aspect ratio
      newHeight = spec.targetHeight!;
      newWidth = spec.targetHeight! * aspectRatio;
      console.log("[applyAspectLockedScaling]   Height specified, calculating width from aspect ratio");
    }

    console.log("[applyAspectLockedScaling]   New size:", newWidth.toFixed(2), "x", newHeight.toFixed(2));

    // Apply the resize
    resizableNode.resize(newWidth, newHeight);
    console.log("[applyAspectLockedScaling]   Resize applied");
    console.log("[applyAspectLockedScaling]   Final size:", node.width, "x", node.height);
  }

  console.log("[applyAspectLockedScaling] Complete. Processed", scaleCount, "nodes with aspect-locked scaling");
}

/**
 * Preserve aspect ratios for all images and vectors in the tree.
 * This ensures visual assets don't get distorted during transformation.
 *
 * Applies to node types: RECTANGLE (with image fill), ELLIPSE, POLYGON, STAR, VECTOR, LINE
 *
 * @param frame - The TikTok variant frame to process
 * @param originalPositions - Original dimensions before transformation
 */
function preserveImageVectorAspectRatios(
  frame: FrameNode,
  originalPositions: Map<string, OriginalPosition>
): void {
  console.log("[preserveAspectRatios] Starting aspect ratio preservation for images/vectors...");

  // Node types that should always preserve aspect ratio
  const ASPECT_LOCKED_TYPES = new Set([
    "ELLIPSE",
    "POLYGON",
    "STAR",
    "VECTOR",
    "LINE",
  ]);

  let preservedCount = 0;

  function walkAndPreserve(node: SceneNode): void {
    // Skip nodes inside component instances - they're frozen
    if (isInsideComponentInstance(node)) {
      return;
    }

    const originalPos = originalPositions.get(node.id);

    // Check if this node should have aspect ratio preserved
    let shouldPreserve = false;
    let reason = "";

    // Check by node type
    if (ASPECT_LOCKED_TYPES.has(node.type)) {
      shouldPreserve = true;
      reason = `type is ${node.type}`;
    }

    // Check for rectangles/frames with image fills
    if (node.type === "RECTANGLE" || node.type === "FRAME") {
      const fillableNode = node as RectangleNode | FrameNode;
      if (Array.isArray(fillableNode.fills)) {
        const hasImageFill = fillableNode.fills.some(
          (fill) => fill.type === "IMAGE" && fill.visible !== false
        );
        if (hasImageFill) {
          shouldPreserve = true;
          reason = "has image fill";
        }
      }
    }

    // Apply aspect ratio preservation if needed
    if (shouldPreserve && originalPos && "resize" in node) {
      const originalAspectRatio = originalPos.width / originalPos.height;
      const currentAspectRatio = node.width / node.height;

      // Check if aspect ratio changed (with small tolerance for floating point)
      const aspectRatioChanged = Math.abs(originalAspectRatio - currentAspectRatio) > 0.01;

      if (aspectRatioChanged) {
        console.log(`[preserveAspectRatios] Fixing ${node.name} (${reason})`);
        console.log(`  Original: ${originalPos.width.toFixed(1)}x${originalPos.height.toFixed(1)} (ratio: ${originalAspectRatio.toFixed(3)})`);
        console.log(`  Current:  ${node.width.toFixed(1)}x${node.height.toFixed(1)} (ratio: ${currentAspectRatio.toFixed(3)})`);

        // Resize to preserve original aspect ratio
        // Use the current width and calculate correct height
        const newHeight = node.width / originalAspectRatio;

        const resizableNode = node as SceneNode & { resize: (w: number, h: number) => void };
        resizableNode.resize(node.width, newHeight);

        console.log(`  Fixed:    ${node.width.toFixed(1)}x${newHeight.toFixed(1)} (ratio: ${(node.width / newHeight).toFixed(3)})`);
        preservedCount++;
      }
    }

    // Recurse into children
    if ("children" in node) {
      for (const child of (node as FrameNode | GroupNode).children) {
        walkAndPreserve(child);
      }
    }
  }

  // Walk the entire tree
  for (const child of frame.children) {
    walkAndPreserve(child);
  }

  console.log(`[preserveAspectRatios] Complete. Fixed ${preservedCount} nodes with distorted aspect ratios`);
}

/**
 * Apply anchor points to control how elements position relative to frame edges.
 * Uses Figma's constraints system for responsive positioning.
 *
 * @param frame - The TikTok variant frame to process
 * @param specMap - Map of node specs
 */
function applyAnchorPoints(
  frame: FrameNode,
  specMap: Map<string, NodeSpec>
): void {
  console.log("[applyAnchorPoints] Starting...");

  // Build complete node map for the entire tree
  const allNodesMap = buildNodeMap(frame);
  console.log("[applyAnchorPoints] Built node map with", allNodesMap.size, "nodes");

  // Find all nodes with anchor points specified
  let anchorCount = 0;
  for (const [nodeId, spec] of specMap) {
    if (!spec.anchor) {
      continue;
    }

    anchorCount++;
    const node = allNodesMap.get(nodeId);

    if (!node) {
      console.log("[applyAnchorPoints] WARNING: Node not found:", nodeId, spec.nodeName);
      continue;
    }

    console.log("[applyAnchorPoints] Processing node:", spec.nodeName, "id:", nodeId);
    console.log("[applyAnchorPoints]   Requested anchor:", JSON.stringify(spec.anchor));

    // CRITICAL: Skip nodes inside component instances - they're frozen
    if (isInsideComponentInstance(node)) {
      console.log("[applyAnchorPoints]   SKIP - inside component instance");
      continue;
    }

    // Check if node supports constraints
    if (!("constraints" in node)) {
      console.log("[applyAnchorPoints]   SKIP - node doesn't support constraints");
      continue;
    }

    const constrainedNode = node as SceneNode & {
      constraints: { horizontal: ConstraintType; vertical: ConstraintType };
    };

    // Map anchor values to Figma constraint types
    const horizontalConstraint = mapAnchorToConstraint(spec.anchor.horizontal);
    const verticalConstraint = mapAnchorToConstraint(spec.anchor.vertical);

    console.log("[applyAnchorPoints]   Original constraints:", JSON.stringify(constrainedNode.constraints));
    console.log("[applyAnchorPoints]   Mapping horizontal:", spec.anchor.horizontal, "->", horizontalConstraint);
    console.log("[applyAnchorPoints]   Mapping vertical:", spec.anchor.vertical, "->", verticalConstraint);

    // Apply constraints
    constrainedNode.constraints = {
      horizontal: horizontalConstraint,
      vertical: verticalConstraint,
    };

    console.log("[applyAnchorPoints]   Applied constraints:", JSON.stringify(constrainedNode.constraints));

    // If anchor is RIGHT or BOTTOM, we need to recalculate x/y positions
    // to be relative to that edge instead of top-left
    if (spec.positioning === "ABSOLUTE") {
      const parent = node.parent as FrameNode;
      if (parent) {
        const parentWidth = parent.width;
        const parentHeight = parent.height;

        console.log("[applyAnchorPoints]   Parent size:", parentWidth, "x", parentHeight);

        // Recalculate position based on anchor
        if (spec.anchor.horizontal === "RIGHT" && spec.x !== undefined) {
          // x is distance from right edge
          const newX = parentWidth - spec.x - node.width;
          console.log("[applyAnchorPoints]   RIGHT anchor: x offset", spec.x, "-> absolute x", newX);
          node.x = newX;
        } else if (spec.anchor.horizontal === "CENTER" && spec.x !== undefined) {
          // x is offset from center
          const centerX = (parentWidth - node.width) / 2;
          const newX = centerX + spec.x;
          console.log("[applyAnchorPoints]   CENTER anchor: x offset", spec.x, "-> absolute x", newX);
          node.x = newX;
        }

        if (spec.anchor.vertical === "BOTTOM" && spec.y !== undefined) {
          // y is distance from bottom edge
          const newY = parentHeight - spec.y - node.height;
          console.log("[applyAnchorPoints]   BOTTOM anchor: y offset", spec.y, "-> absolute y", newY);
          node.y = newY;
        } else if (spec.anchor.vertical === "CENTER" && spec.y !== undefined) {
          // y is offset from center
          const centerY = (parentHeight - node.height) / 2;
          const newY = centerY + spec.y;
          console.log("[applyAnchorPoints]   CENTER anchor: y offset", spec.y, "-> absolute y", newY);
          node.y = newY;
        }

        console.log("[applyAnchorPoints]   Final position: x=", node.x, "y=", node.y);
      }
    }
  }

  console.log("[applyAnchorPoints] Complete. Processed", anchorCount, "nodes with anchor points");
}

/**
 * Map anchor string to Figma constraint type.
 */
function mapAnchorToConstraint(anchor: "LEFT" | "CENTER" | "RIGHT" | "TOP" | "BOTTOM"): ConstraintType {
  console.log("[mapAnchorToConstraint] Mapping:", anchor);
  switch (anchor) {
    case "LEFT":
    case "TOP":
      return "MIN";
    case "CENTER":
      return "CENTER";
    case "RIGHT":
    case "BOTTOM":
      return "MAX";
    default:
      console.log("[mapAnchorToConstraint] Unknown anchor, defaulting to MIN");
      return "MIN";
  }
}

/**
 * Apply NATIVE FIGMA layout strategy - uses ONLY native Figma API features.
 * No absolute positioning, no AI coordinates - purely responsive native features:
 * - Auto-layout WRAP for flowing content
 * - Min/max constraints for responsive sizing
 * - SPACE_BETWEEN distribution for even spacing
 * - Counter-axis CENTER for centered alignment
 *
 * This creates a visually distinct output that relies on Figma's
 * responsive layout system rather than manual positioning.
 */
function applyNativeFigmaLayout(
  frame: FrameNode,
  specMap: Map<string, NodeSpec>,
  originalWidth: number,
  originalHeight: number
): void {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║ [applyNativeFigmaLayout] MODE: NATIVE_FIGMA                      ║");
  console.log("║ Using ONLY native Figma API features - no absolute positioning  ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");

  const scaleX = frame.width / originalWidth;
  const scaleY = frame.height / originalHeight;
  console.log(`[applyNativeFigmaLayout] Scale factors - X: ${scaleX.toFixed(3)}, Y: ${scaleY.toFixed(3)}`);

  // ============================================
  // STEP 1: Configure root frame with WRAP layout
  // ============================================
  console.log("[applyNativeFigmaLayout] STEP 1: Configuring root frame with WRAP layout");

  // Enable auto-layout with WRAP - this is a key native Figma feature
  frame.layoutMode = "HORIZONTAL";  // Changed from VERTICAL for wrap effect
  frame.layoutWrap = "WRAP";        // Enable wrapping!
  frame.primaryAxisAlignItems = "SPACE_BETWEEN";  // Distribute space evenly
  frame.counterAxisAlignItems = "MIN";            // Align to top
  frame.itemSpacing = 24;           // Gap between items
  frame.counterAxisSpacing = 32;    // Gap between wrapped rows

  // Use STANDARD padding for consistency across all variants
  frame.paddingTop = STANDARD_PADDING.top;
  frame.paddingRight = STANDARD_PADDING.right;
  frame.paddingBottom = STANDARD_PADDING.bottom;
  frame.paddingLeft = STANDARD_PADDING.left;

  console.log(`[applyNativeFigmaLayout] Root frame configured:`);
  console.log(`  layoutMode: HORIZONTAL, layoutWrap: WRAP`);
  console.log(`  itemSpacing: 24, counterAxisSpacing: 32`);
  console.log(`  padding: T=${STANDARD_PADDING.top} R=${STANDARD_PADDING.right} B=${STANDARD_PADDING.bottom} L=${STANDARD_PADDING.left} (STANDARD)`);

  // ============================================
  // STEP 2: Apply min/max constraints to children
  // ============================================
  console.log("[applyNativeFigmaLayout] STEP 2: Applying min/max constraints to children");

  const contentWidth = frame.width - frame.paddingLeft - frame.paddingRight;
  console.log(`[applyNativeFigmaLayout] Available content width: ${contentWidth}px`);

  let processedCount = 0;

  for (const child of frame.children) {
    if (!("layoutSizingHorizontal" in child)) {
      console.log(`[applyNativeFigmaLayout] SKIP (no sizing): ${child.name}`);
      continue;
    }

    // Skip component instances - they're frozen
    if (isInsideComponentInstance(child)) {
      console.log(`[applyNativeFigmaLayout] SKIP (component instance): ${child.name}`);
      continue;
    }

    const spec = specMap.get(child.id);
    const nodeName = spec?.nodeName || child.name;

    console.log(`[applyNativeFigmaLayout] Processing: ${nodeName} (${child.type})`);

    // For frames with children, apply nested auto-layout with responsive settings
    if (child.type === "FRAME") {
      const frameChild = child as FrameNode;

      // If it has children and no auto-layout, enable it BEFORE setting sizing
      if (frameChild.layoutMode === "NONE" && frameChild.children.length > 0) {
        console.log(`[applyNativeFigmaLayout]   Converting to VERTICAL auto-layout`);
        frameChild.layoutMode = "VERTICAL";
        frameChild.itemSpacing = 16;
        frameChild.counterAxisAlignItems = "CENTER";
      }

      // Now that it's auto-layout (or already was), we can set FILL/HUG
      // HUG only works on auto-layout frames
      if (frameChild.layoutMode !== "NONE") {
        frameChild.layoutSizingHorizontal = "FILL";
        frameChild.layoutSizingVertical = "HUG";
        console.log(`[applyNativeFigmaLayout]   Sizing: FILL width, HUG height`);
      } else {
        // Non-auto-layout frame with no children - use FIXED
        frameChild.layoutSizingHorizontal = "FIXED";
        frameChild.layoutSizingVertical = "FIXED";
        console.log(`[applyNativeFigmaLayout]   Sizing: FIXED (no auto-layout)`);
      }

      // Apply min/max width constraints - KEY native Figma feature
      // minWidth ensures content doesn't shrink too small
      // maxWidth ensures content doesn't stretch too wide
      // Note: min/max only work on auto-layout frames
      if (frameChild.layoutMode !== "NONE") {
        const originalChildWidth = child.width;
        const minW = Math.max(200, originalChildWidth * 0.6);
        const maxW = Math.min(contentWidth, originalChildWidth * 1.2);

        frameChild.minWidth = minW;
        frameChild.maxWidth = maxW;

        console.log(`[applyNativeFigmaLayout]   Applied constraints: minWidth=${minW.toFixed(0)}, maxWidth=${maxW.toFixed(0)}`);

        // Apply min/max height for responsive vertical sizing
        const originalChildHeight = child.height;
        frameChild.minHeight = Math.max(100, originalChildHeight * 0.5);
        frameChild.maxHeight = originalChildHeight * 1.5;

        console.log(`[applyNativeFigmaLayout]   Height constraints: minHeight=${frameChild.minHeight?.toFixed(0)}, maxHeight=${frameChild.maxHeight?.toFixed(0)}`);
      }
    }

    // For text nodes, set them to FILL width (parent is auto-layout so this works)
    else if (child.type === "TEXT") {
      child.layoutSizingHorizontal = "FILL";
      child.layoutSizingVertical = "HUG";
      console.log(`[applyNativeFigmaLayout]   Text set to FILL width, HUG height`);
    }

    // For images/rectangles, maintain aspect ratio via constrainProportions
    else if (child.type === "RECTANGLE" || child.type === "ELLIPSE") {
      if ("constrainProportions" in child) {
        (child as RectangleNode).constrainProportions = true;
        console.log(`[applyNativeFigmaLayout]   Enabled constrainProportions`);
      }
      // Use FIXED for shapes - HUG doesn't work on rectangles/ellipses
      child.layoutSizingHorizontal = "FIXED";
      child.layoutSizingVertical = "FIXED";
      console.log(`[applyNativeFigmaLayout]   Shape sizing: FIXED`);
    }

    // For other node types (groups, vectors, etc.) use FIXED
    else {
      child.layoutSizingHorizontal = "FIXED";
      child.layoutSizingVertical = "FIXED";
      console.log(`[applyNativeFigmaLayout]   Other node type: FIXED sizing`);
    }

    processedCount++;
  }

  console.log(`[applyNativeFigmaLayout] Processed ${processedCount} direct children`);

  // ============================================
  // STEP 3: Apply nested constraints recursively
  // ============================================
  console.log("[applyNativeFigmaLayout] STEP 3: Applying nested constraints recursively");

  function applyNestedNativeFeatures(parent: FrameNode): void {
    for (const child of parent.children) {
      if (child.type !== "FRAME") continue;
      if (isInsideComponentInstance(child)) continue;

      const frameChild = child as FrameNode;

      // For nested frames, use CENTER counter-axis alignment
      if (frameChild.layoutMode !== "NONE") {
        frameChild.counterAxisAlignItems = "CENTER";
        console.log(`[applyNativeFigmaLayout]   Nested frame ${frameChild.name}: counterAxisAlignItems=CENTER`);
      }

      // Recursively process nested children
      applyNestedNativeFeatures(frameChild);
    }
  }

  for (const child of frame.children) {
    if (child.type === "FRAME") {
      applyNestedNativeFeatures(child as FrameNode);
    }
  }

  // ============================================
  // STEP 4: Final adjustments for visual distinction
  // ============================================
  console.log("[applyNativeFigmaLayout] STEP 4: Final adjustments for visual distinction");

  // Ensure the root frame uses CENTER for primary axis (centered wrapping)
  frame.primaryAxisAlignItems = "CENTER";
  console.log(`[applyNativeFigmaLayout] Root primaryAxisAlignItems set to CENTER`);

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║ [applyNativeFigmaLayout] COMPLETE                                ║");
  console.log("║ Native Figma features applied: WRAP, min/max, FILL, CENTER      ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
}

/**
 * Apply NATIVE SMART layout - intelligent composition using native Figma API.
 * Uses semantic groups to create visual hierarchy:
 * - Hero/Product elements get prominence (larger, more space)
 * - Brand elements stay compact
 * - CTA elements get breathing room
 * - Decorative elements are de-emphasized
 *
 * Creates visual rhythm with varying gaps based on content transitions.
 */
function applyNativeSmartLayout(
  frame: FrameNode,
  specMap: Map<string, NodeSpec>,
  semanticGroups: SemanticGroup[],
  originalWidth: number,
  originalHeight: number
): void {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║ [applyNativeSmartLayout] MODE: NATIVE_SMART                      ║");
  console.log("║ Intelligent composition with visual hierarchy and rhythm         ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");

  // Build semantic lookup: nodeId -> role
  const nodeToRole = new Map<string, string>();
  for (const group of semanticGroups) {
    for (const nodeId of group.nodeIds) {
      nodeToRole.set(nodeId, group.role);
    }
  }
  console.log(`[applyNativeSmartLayout] Semantic map: ${nodeToRole.size} nodes with roles`);

  // ============================================
  // STEP 1: Configure root frame for VERTICAL flow (not wrap)
  // Smart composition uses deliberate vertical stacking
  // ============================================
  frame.layoutMode = "VERTICAL";
  frame.layoutWrap = "NO_WRAP";
  frame.primaryAxisAlignItems = "MIN";      // Top-aligned, content flows down
  frame.counterAxisAlignItems = "CENTER";   // Horizontally centered
  frame.itemSpacing = 24;                   // Base rhythm

  // Use STANDARD padding for consistency across all variants
  frame.paddingTop = STANDARD_PADDING.top;
  frame.paddingRight = STANDARD_PADDING.right;
  frame.paddingBottom = STANDARD_PADDING.bottom;
  frame.paddingLeft = STANDARD_PADDING.left;

  console.log(`[applyNativeSmartLayout] Root: VERTICAL, padding T${STANDARD_PADDING.top} R${STANDARD_PADDING.right} B${STANDARD_PADDING.bottom} L${STANDARD_PADDING.left} (STANDARD)`);

  const contentWidth = frame.width - frame.paddingLeft - frame.paddingRight;
  console.log(`[applyNativeSmartLayout] Content width: ${contentWidth}px`);

  // ============================================
  // STEP 2: Apply role-based sizing and spacing
  // ============================================
  console.log("[applyNativeSmartLayout] STEP 2: Applying role-based composition");

  let prevRole: string | null = null;

  for (const child of frame.children) {
    if (!("layoutSizingHorizontal" in child)) continue;
    if (isInsideComponentInstance(child)) continue;

    const role = nodeToRole.get(child.id) || "unknown";
    const nodeName = child.name;

    console.log(`[applyNativeSmartLayout] Processing: ${nodeName} (role: ${role})`);

    // Determine sizing based on semantic role
    let targetWidthPercent = 1.0;  // Default: full width
    let extraSpacingBefore = 0;
    let extraSpacingAfter = 0;

    switch (role) {
      case "hero":
        // Hero gets full width, extra space after
        targetWidthPercent = 1.0;
        extraSpacingAfter = 16;
        console.log(`[applyNativeSmartLayout]   HERO: full width, +${extraSpacingAfter}px after`);
        break;

      case "product":
        // Product mockups get prominence, centered
        targetWidthPercent = 0.95;
        extraSpacingBefore = 20;
        extraSpacingAfter = 20;
        console.log(`[applyNativeSmartLayout]   PRODUCT: 95% width, extra breathing room`);
        break;

      case "brand":
        // Brand elements stay compact
        targetWidthPercent = 0.5;
        extraSpacingAfter = 8;
        console.log(`[applyNativeSmartLayout]   BRAND: 50% width, compact`);
        break;

      case "cta":
        // CTA needs emphasis and space
        targetWidthPercent = 0.8;
        extraSpacingBefore = 24;
        console.log(`[applyNativeSmartLayout]   CTA: 80% width, space before for emphasis`);
        break;

      case "features":
        // Features list - full width for readability
        targetWidthPercent = 1.0;
        extraSpacingBefore = 12;
        console.log(`[applyNativeSmartLayout]   FEATURES: full width for readability`);
        break;

      case "metadata":
        // Metadata is secondary - smaller
        targetWidthPercent = 0.7;
        console.log(`[applyNativeSmartLayout]   METADATA: 70% width, secondary`);
        break;

      case "decorative":
        // Decorative can be full bleed
        targetWidthPercent = 1.0;
        console.log(`[applyNativeSmartLayout]   DECORATIVE: full width`);
        break;

      default:
        // Unknown - use sensible default
        targetWidthPercent = 0.9;
        console.log(`[applyNativeSmartLayout]   UNKNOWN: 90% width default`);
    }

    // Apply sizing based on node type
    if (child.type === "FRAME") {
      const frameChild = child as FrameNode;

      // Convert to auto-layout if needed
      if (frameChild.layoutMode === "NONE" && frameChild.children.length > 0) {
        frameChild.layoutMode = "VERTICAL";
        frameChild.itemSpacing = 12;
        frameChild.counterAxisAlignItems = "CENTER";
        console.log(`[applyNativeSmartLayout]   Converted to VERTICAL auto-layout`);
      }

      if (frameChild.layoutMode !== "NONE") {
        frameChild.layoutSizingHorizontal = "FILL";
        frameChild.layoutSizingVertical = "HUG";

        // Apply min/max based on role
        const targetWidth = contentWidth * targetWidthPercent;
        frameChild.minWidth = Math.max(200, targetWidth * 0.8);
        frameChild.maxWidth = targetWidth;

        console.log(`[applyNativeSmartLayout]   Constraints: min=${frameChild.minWidth?.toFixed(0)}, max=${frameChild.maxWidth?.toFixed(0)}`);
      } else {
        frameChild.layoutSizingHorizontal = "FIXED";
        frameChild.layoutSizingVertical = "FIXED";
      }
    } else if (child.type === "TEXT") {
      child.layoutSizingHorizontal = "FILL";
      child.layoutSizingVertical = "HUG";
      console.log(`[applyNativeSmartLayout]   Text: FILL width, HUG height`);
    } else {
      // Images, shapes, etc.
      child.layoutSizingHorizontal = "FIXED";
      child.layoutSizingVertical = "FIXED";

      // Scale based on role
      if (role === "product" || role === "hero") {
        // Make hero/product images larger
        const scale = Math.min(contentWidth / child.width, 1.2);
        if (scale > 1 && "resize" in child) {
          (child as FrameNode).resize(child.width * scale, child.height * scale);
          console.log(`[applyNativeSmartLayout]   Scaled up by ${scale.toFixed(2)}x for prominence`);
        }
      }
    }

    prevRole = role;
  }

  // ============================================
  // STEP 3: Apply visual rhythm via spacing
  // ============================================
  console.log("[applyNativeSmartLayout] STEP 3: Applying visual rhythm");

  // Create rhythm by varying itemSpacing based on content
  // Since Figma auto-layout uses uniform spacing, we achieve rhythm
  // by setting a balanced base spacing
  const childCount = frame.children.length;
  if (childCount <= 3) {
    frame.itemSpacing = 32;  // Fewer items = more breathing room
    console.log(`[applyNativeSmartLayout]   Few children (${childCount}): generous spacing 32px`);
  } else if (childCount <= 6) {
    frame.itemSpacing = 24;  // Medium density
    console.log(`[applyNativeSmartLayout]   Medium children (${childCount}): balanced spacing 24px`);
  } else {
    frame.itemSpacing = 16;  // Many items = tighter to fit
    console.log(`[applyNativeSmartLayout]   Many children (${childCount}): compact spacing 16px`);
  }

  // ============================================
  // STEP 4: Final composition adjustments
  // ============================================
  console.log("[applyNativeSmartLayout] STEP 4: Final composition adjustments");

  // Use SPACE_BETWEEN if we have distinct content sections
  const hasHero = Array.from(nodeToRole.values()).includes("hero");
  const hasCta = Array.from(nodeToRole.values()).includes("cta");

  if (hasHero && hasCta && childCount >= 3) {
    frame.primaryAxisAlignItems = "SPACE_BETWEEN";
    console.log(`[applyNativeSmartLayout]   Hero+CTA detected: using SPACE_BETWEEN for dramatic composition`);
  }

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║ [applyNativeSmartLayout] COMPLETE                                ║");
  console.log("║ Applied: role-based sizing, visual rhythm, smart spacing        ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
}

/**
 * Apply NATIVE GRID layout - uses Figma's actual GRID layoutMode.
 * Uses Figma's native Grid API features:
 * - layoutMode = "GRID" for true grid layout
 * - gridColumnCount / gridRowCount for grid dimensions
 * - gridColumnGap / gridRowGap for gutters
 * - setGridChildPosition() for positioning children
 */
function applyNativeGridLayout(
  frame: FrameNode,
  specMap: Map<string, NodeSpec>,
  originalWidth: number,
  originalHeight: number
): void {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║ [applyNativeGridLayout] MODE: NATIVE_GRID                        ║");
  console.log("║ Using Figma's native GRID layoutMode API                         ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");

  const children = [...frame.children];
  const childCount = children.length;

  // ============================================
  // STEP 1: Enable GRID layout mode FIRST
  // ============================================
  console.log("[applyNativeGridLayout] STEP 1: Enabling GRID layout mode");

  // Calculate optimal grid dimensions based on child count
  let columns = 2;
  let rows = Math.ceil(childCount / columns);

  // Adjust for better aspect ratio
  if (childCount <= 2) {
    columns = 1;
    rows = childCount;
  } else if (childCount <= 4) {
    columns = 2;
    rows = Math.ceil(childCount / 2);
  } else if (childCount <= 6) {
    columns = 2;
    rows = Math.ceil(childCount / 2);
  } else {
    columns = 3;
    rows = Math.ceil(childCount / 3);
  }

  console.log(`[applyNativeGridLayout] Grid dimensions: ${columns} columns x ${rows} rows for ${childCount} children`);

  // Set GRID layout mode BEFORE other properties
  frame.layoutMode = "GRID";
  frame.gridColumnCount = columns;
  frame.gridRowCount = rows;

  // Set gaps (vertical = gridRowGap, horizontal = gridColumnGap)
  const gridGap = 24;  // Consistent with other variants' itemSpacing
  frame.gridColumnGap = gridGap;
  frame.gridRowGap = gridGap;

  // Apply STANDARD padding AFTER layoutMode is set
  frame.paddingTop = STANDARD_PADDING.top;
  frame.paddingRight = STANDARD_PADDING.right;
  frame.paddingBottom = STANDARD_PADDING.bottom;
  frame.paddingLeft = STANDARD_PADDING.left;

  const contentWidth = frame.width - frame.paddingLeft - frame.paddingRight;
  const contentHeight = frame.height - frame.paddingTop - frame.paddingBottom;

  console.log(`[applyNativeGridLayout] Grid configured:`);
  console.log(`  layoutMode: GRID`);
  console.log(`  gridColumnCount: ${columns}`);
  console.log(`  gridRowCount: ${rows}`);
  console.log(`  gridColumnGap: ${gridGap}px (horizontal)`);
  console.log(`  gridRowGap: ${gridGap}px (vertical)`);
  console.log(`  padding: T${STANDARD_PADDING.top} R${STANDARD_PADDING.right} B${STANDARD_PADDING.bottom} L${STANDARD_PADDING.left}`);
  console.log(`  content area: ${contentWidth}px x ${contentHeight}px`);

  // ============================================
  // STEP 2: Position children in grid cells
  // ============================================
  console.log("[applyNativeGridLayout] STEP 2: Positioning children in grid cells");

  let currentRow = 0;
  let currentCol = 0;

  for (const child of children) {
    if (isInsideComponentInstance(child)) {
      console.log(`[applyNativeGridLayout] SKIP (component instance): ${child.name}`);
      continue;
    }

    console.log(`[applyNativeGridLayout] Placing ${child.name} at row=${currentRow}, col=${currentCol}`);

    // Position the child in the grid
    try {
      if ("setGridChildPosition" in child) {
        (child as SceneNode & { setGridChildPosition: (row: number, col: number) => void }).setGridChildPosition(currentRow, currentCol);
        console.log(`[applyNativeGridLayout]   Positioned via setGridChildPosition()`);
      }
    } catch (e) {
      console.log(`[applyNativeGridLayout]   Could not position: ${e}`);
    }

    // Set grid child alignment
    if ("gridChildHorizontalAlign" in child) {
      (child as SceneNode & { gridChildHorizontalAlign: string }).gridChildHorizontalAlign = "CENTER";
    }
    if ("gridChildVerticalAlign" in child) {
      (child as SceneNode & { gridChildVerticalAlign: string }).gridChildVerticalAlign = "CENTER";
    }

    // Move to next cell
    currentCol++;
    if (currentCol >= columns) {
      currentCol = 0;
      currentRow++;
    }
  }

  // ============================================
  // STEP 3: Configure child sizing and alignment
  // ============================================
  console.log("[applyNativeGridLayout] STEP 3: Configuring child sizing");
  console.log("[applyNativeGridLayout] NOTE: layoutSizing* doesn't apply to Grid children");
  console.log("[applyNativeGridLayout] Using gridChildAlign* properties instead");

  for (const child of children) {
    if (isInsideComponentInstance(child)) continue;

    // Grid children don't use layoutSizingHorizontal/Vertical
    // Instead, sizing is controlled by grid cell and alignment properties

    // Set grid alignment - valid values: MIN | CENTER | MAX | AUTO
    // Note: Figma Grid doesn't have STRETCH - children maintain their size
    // AUTO uses default alignment based on content
    if ("gridChildHorizontalAlign" in child) {
      (child as any).gridChildHorizontalAlign = "CENTER";
      (child as any).gridChildVerticalAlign = "CENTER";
      console.log(`[applyNativeGridLayout]   ${child.name}: gridChildAlign = CENTER/CENTER`);
    }

    // For frames, ensure they have auto-layout for their internal children
    // Note: The frame itself is a Grid child, so layoutSizing* doesn't apply to it
    // But we enable auto-layout so its OWN children are arranged properly
    if (child.type === "FRAME") {
      const frameChild = child as FrameNode;
      if (frameChild.layoutMode === "NONE" && frameChild.children.length > 0) {
        frameChild.layoutMode = "VERTICAL";
        frameChild.counterAxisAlignItems = "CENTER";
        frameChild.primaryAxisAlignItems = "CENTER";
        frameChild.itemSpacing = 8;
        console.log(`[applyNativeGridLayout]     Converted to VERTICAL auto-layout (internal)`);
        // Note: layoutSizing* not set - frame is Grid child, not auto-layout child
      }
    }
  }

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║ [applyNativeGridLayout] COMPLETE                                 ║");
  console.log("║ Applied: GRID layoutMode, ${columns}x${rows} grid, centered cells               ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
}
