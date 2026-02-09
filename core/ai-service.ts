/**
 * AI Service Module
 *
 * Single OpenAI call that takes frame image + node tree and returns
 * a complete layout specification for TikTok format.
 */

import type { LayoutSpec, NodeTreeItem } from "../types/layout-spec";

// Default API key injected at build time (can be overridden by user)
declare const __SCALERESIZER_DEFAULT_AI_KEY__: string;

let apiKey: string = typeof __SCALERESIZER_DEFAULT_AI_KEY__ !== "undefined"
  ? __SCALERESIZER_DEFAULT_AI_KEY__
  : "";

console.log("[ai-service] Module loaded, default key configured:", apiKey.length > 0);

/**
 * Set the OpenAI API key for subsequent calls.
 */
export function setApiKey(key: string): void {
  console.log("[ai-service] setApiKey called, key length:", key.length);
  apiKey = key;
}

/**
 * Check if an API key is configured.
 */
export function hasApiKey(): boolean {
  const has = apiKey.length > 0;
  console.log("[ai-service] hasApiKey:", has);
  return has;
}

/**
 * Generate a layout specification for transforming a frame to TikTok format.
 *
 * @param imageBase64 - Base64-encoded PNG of the source frame
 * @param nodeTree - Simplified node tree of the frame
 * @param sourceWidth - Original frame width
 * @param sourceHeight - Original frame height
 * @returns Layout specification for TikTok format
 */
export async function generateLayoutSpec(
  imageBase64: string,
  nodeTree: NodeTreeItem,
  sourceWidth: number,
  sourceHeight: number
): Promise<LayoutSpec> {
  console.log("[ai-service] generateLayoutSpec called");
  console.log("[ai-service] Image base64 length:", imageBase64.length);
  console.log("[ai-service] Source dimensions:", sourceWidth, "x", sourceHeight);
  console.log("[ai-service] Node tree root:", nodeTree.name);

  if (!apiKey) {
    console.error("[ai-service] ERROR: No API key configured");
    throw new Error("OpenAI API key not configured");
  }

  const prompt = buildPrompt(nodeTree, sourceWidth, sourceHeight);
  console.log("[ai-service] Prompt built, length:", prompt.length);

  console.log("[ai-service] Sending request to OpenAI...");
  const startTime = Date.now();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
                detail: "high",
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0,
      seed: 42,
    }),
  });

  const elapsed = Date.now() - startTime;
  console.log("[ai-service] Response received in", elapsed, "ms, status:", response.status);

  if (!response.ok) {
    const error = await response.text();
    console.error("[ai-service] API error:", response.status, error);
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as OpenAIResponse;
  const content = data.choices?.[0]?.message?.content;
  console.log("[ai-service] Response content length:", content?.length ?? 0);

  if (!content) {
    console.error("[ai-service] No content in response");
    throw new Error("No response content from OpenAI");
  }

  console.log("[ai-service] Raw AI response (first 500 chars):", content.substring(0, 500));

  const spec = parseLayoutSpec(content);
  console.log("[ai-service] Parsed layout spec successfully");
  console.log("[ai-service] Spec nodes count:", spec.nodes.length);
  console.log("[ai-service] Semantic groups count:", spec.semanticGroups?.length ?? 0);
  if (spec.semanticGroups && spec.semanticGroups.length > 0) {
    console.log("[ai-service] Semantic groups:", spec.semanticGroups.map(g => `${g.role}(${g.nodeIds.length} nodes, order:${g.order}, visible:${g.visible})`).join(", "));
  }
  console.log("[ai-service] Spec reasoning:", spec.reasoning);

  return spec;
}

/**
 * System prompt that defines the AI's role and output format.
 */
const SYSTEM_PROMPT = `You are a professional marketing designer transforming designs for TikTok vertical format (1080×1920).

Your task is to analyze the provided marketing frame and output a JSON layout specification that rearranges its elements for optimal TikTok display.

## TikTok Safe Areas
- TOP 8% (0-154px): Danger zone - overlapped by status bar and TikTok UI
- BOTTOM 35% (1248-1920px): Danger zone - overlapped by buttons, captions, engagement UI
- SAFE ZONE: 154-1248px (the middle ~60% of the screen)

## Key Principles
1. Place primary content (hero images, main message) in the safe zone
2. Move CTAs and important text away from bottom danger zone
3. Stack elements vertically - TikTok users scroll, not scan horizontally
4. Hide elements that don't work in vertical format (wide banners, horizontal galleries)
5. Prioritize visual hierarchy: hero first, supporting content second, CTAs in safe areas

## Design Adaptation (Not Redesign)

Your goal is to ADAPT the existing design to TikTok format while PRESERVING its visual character. The output should feel like the same design reformatted, not a new design.

**Analyze the source design first:**
1. Spacing rhythm - What's the ratio between tight gaps (within groups) vs loose gaps (between sections)?
2. Alignment pattern - Is content centered, left-aligned, or asymmetric?
3. Visual density feel - Is the design airy with breathing room, or compact and content-rich?
4. Grouping intent - What did the designer visually cluster together?
5. Visual weight distribution - Where is the focal point? What's dominant?

**Preserve these characteristics:**
- If source has 2:1 ratio between section gaps and item gaps, maintain that ratio in output
- If source is left-aligned, output stays left-aligned (counterAxisAlign: "MIN")
- If source is centered, output stays centered (counterAxisAlign: "CENTER")
- If source feels spacious, use the upper range of calculated padding/gaps
- If elements are visually grouped in the source, they MUST stay together in the same semantic group
- The visual hierarchy order in the source should inform the semantic group ordering

**Do NOT impose:**
- Don't center content if the source is left-aligned
- Don't add spacing patterns that weren't in the original
- Don't separate elements the designer intentionally grouped together
- Don't change the "feel" of the design - airy stays airy, dense stays dense

## Semantic Grouping
Analyze the design and group related elements by their semantic purpose. Elements that belong together visually should be in the same group.

**Semantic Roles:**
- "hero": Main headline, tagline, primary message - place at top in safe zone
- "product": Device mockups, screenshots, main product imagery
- "features": Feature lists, benefits, bullet points with icons
- "cta": Call-to-action text, website URLs, buttons - position carefully (avoid bottom danger zone)
- "brand": Logo, brand marks - usually at top or bottom
- "metadata": Author info, dates, read times, secondary text - often hidden on mobile
- "decorative": Background shapes, accents, non-essential visuals - usually hidden

**Grouping Rules:**
1. Elements that belong together visually → same group (headline + subhead = one "hero" group)
2. An icon and its label → keep in same group (part of "features")
3. Multiple related buttons → one "cta" group
4. Order groups for TikTok: hero first (1-10), product/features middle (20-40), cta/brand at bottom (50-70)
5. Set visible: false for "decorative" and "metadata" groups when they clutter mobile view

### Spacing Preservation (preserveSpacing)
Set preserveSpacing: true for groups where the relative spacing between elements must be maintained.
The system will keep original X positions and center the composition horizontally, rather than using AI-specified coordinates.

**Use preserveSpacing: true for:**
- Product mockup groups (phones side by side, device arrangements)
- Feature lists where icon-text gap rhythm matters
- Multi-element compositions that should scale as a unit

**When preserveSpacing is true:**
- Do NOT specify x/y on individual nodes (the system handles positioning)
- The group's elements will maintain their relative horizontal positions
- The composition will be uniformly scaled and centered in the frame

## Padding & Spacing Guidelines
Calculate padding and gap dynamically based on source frame characteristics - DO NOT copy example values verbatim.

**Top Padding**: 160-200px minimum (must clear TikTok status bar at 154px)
**Bottom Padding**: 40-80px (avoid engagement UI overlap, but don't waste vertical space)
**Side Padding**: Scale proportionally from source - typically 24-48px for breathing room
**Gap Between Elements**: Based on source frame's visual density:
  - Dense content (many small elements): 16-24px for compact feel
  - Medium density (typical marketing): 24-32px balanced spacing
  - Sparse/hero-focused (large imagery): 32-48px for dramatic effect

Analyze the source frame's content type:
- Product showcases need breathing room (larger gaps)
- Text-heavy layouts need tighter spacing to fit content
- Hero-driven designs benefit from generous padding

## Output Format
Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "semanticGroups": [
    {
      "groupId": "group-1",
      "role": "hero",
      "nodeIds": ["123:456", "123:457"],
      "order": 10,
      "visible": true
    },
    {
      "groupId": "group-2",
      "role": "product",
      "nodeIds": ["123:460", "123:461"],
      "order": 20,
      "visible": true,
      "preserveSpacing": true
    },
    {
      "groupId": "group-3",
      "role": "cta",
      "nodeIds": ["123:470", "123:471"],
      "order": 50,
      "visible": true,
      "layoutDirection": "HORIZONTAL"
    },
    {
      "groupId": "group-4",
      "role": "decorative",
      "nodeIds": ["123:480"],
      "order": 99,
      "visible": false
    }
  ],
  "nodes": [
    {
      "nodeId": "123:456",
      "nodeName": "Hero Image",
      "visible": true,
      "order": 0,
      "widthSizing": "FILL",
      "heightSizing": "HUG"
    },
    {
      "nodeId": "123:460",
      "nodeName": "Phone Mockup",
      "visible": true,
      "order": 0,
      "widthSizing": "FIXED",
      "heightSizing": "FIXED",
      "positioning": "ABSOLUTE",
      "x": 540,
      "y": 600,
      "zIndex": 10
    }
  ],
  "rootLayout": {
    "direction": "VERTICAL",
    "padding": { "top": 180, "right": 40, "bottom": 60, "left": 40 },
    "gap": 28,
    "primaryAxisAlign": "MIN",
    "counterAxisAlign": "CENTER",
    "clipContent": false
  },
  "reasoning": "Brief explanation of semantic grouping and layout decisions"
}

**semanticGroups**: Groups of related elements. Use group order values (10, 20, 30...) for positioning.
**nodes**: Individual node overrides for sizing/scale. The order field in nodes is now secondary to group ordering.

IMPORTANT: The values above are examples only. Calculate appropriate values based on the source frame.

## Sizing Modes
- FILL: Element expands to fill available space (use for full-width images, backgrounds)
- HUG: Element shrinks to fit content (use for text, buttons)
- FIXED: Element keeps its original size (rarely needed)

## Order Values
Lower order numbers appear first (top) in the vertical layout. Use order to prioritize content.

## Node Tree Properties
The node tree includes:
- layoutMode: For FRAME nodes - "NONE" (absolute), "HORIZONTAL", or "VERTICAL"
- isGroup: true for GROUP nodes (cannot have auto-layout, will be converted to frames)

## Nested Container Control (layoutDirection)
By default, all nested containers are converted to VERTICAL auto-layout for proper TikTok stacking.
Use layoutDirection to override this behavior:
- "VERTICAL": Convert to vertical auto-layout (default, omit to use)
- "HORIZONTAL": Convert to horizontal auto-layout (for icon rows, button groups)
- "NONE": Keep absolute positioning (for decorative overlays, floating badges, complex positioned elements)

Example with layoutDirection:
{
  "nodeId": "456:789",
  "nodeName": "Badge Container",
  "visible": true,
  "order": 0,
  "widthSizing": "HUG",
  "heightSizing": "HUG",
  "layoutDirection": "NONE"
}

## Advanced Composition Controls

### Absolute Positioning (positioning, x, y)
Break elements out of auto-layout flow and place at specific coordinates.
Use for:
- Product mockups extending beyond frame edges
- Floating badges or stickers overlapping other elements
- Asymmetric layouts with precise placement

Properties:
- "positioning": "ABSOLUTE" - Remove from auto-layout flow
- "x": X coordinate relative to parent (can be negative for left bleed)
- "y": Y coordinate relative to parent (can be negative for top bleed)

Example - Phone mockup bleeding off right edge:
{
  "nodeId": "123:456",
  "nodeName": "Phone Mockup",
  "visible": true,
  "order": 0,
  "widthSizing": "FIXED",
  "heightSizing": "FIXED",
  "positioning": "ABSOLUTE",
  "x": 540,
  "y": 600,
  "zIndex": 10
}

### Overflow Control (clipContent in rootLayout)
Control whether content can visually extend beyond frame boundaries.
- true (default): Content clipped at edges - clean, contained look
- false: Content can bleed beyond edges - dynamic, breaking-the-frame effects

Use clipContent: false when:
- Product mockups should extend beyond frame edges
- Elements need to create dynamic edge-bleeding effects
- Design has intentional overflow aesthetics

### Z-Index Stacking (zIndex)
Control which elements appear in front of others.
Higher zIndex values appear in front of lower values.

Use for:
- Floating badges on top of product images (zIndex: 20)
- Product mockups in front of background elements (zIndex: 10)
- Background decorative elements behind everything (zIndex: 1)

Example - Layered composition:
{
  "nodeId": "bg-element",
  "nodeName": "Background Gradient",
  "zIndex": 1,
  ...
},
{
  "nodeId": "phone-mockup",
  "nodeName": "Phone Mockup",
  "positioning": "ABSOLUTE",
  "x": 600,
  "y": 500,
  "zIndex": 10,
  ...
},
{
  "nodeId": "floating-badge",
  "nodeName": "Sale Badge",
  "positioning": "ABSOLUTE",
  "x": 900,
  "y": 400,
  "zIndex": 20,
  ...
}

### Rotation (rotation)
Apply rotation transforms to create dynamic, angled compositions.
Positive values rotate counterclockwise (Figma convention).

Use for:
- Tilted phone mockups for dynamic energy (-15° to 15° typical)
- Angled badges or stickers for playful effect
- Rotated decorative elements

Example - Phone tilted for dynamic effect:
{
  "nodeId": "123:456",
  "nodeName": "Phone Mockup",
  "positioning": "ABSOLUTE",
  "x": 600,
  "y": 500,
  "rotation": -12,
  "zIndex": 10,
  ...
}

### Aspect-Locked Scaling (aspectLocked, targetWidth, targetHeight)
Scale elements while maintaining their original proportions.
Prevents distortion when resizing product mockups or images.

Properties:
- "aspectLocked": true - Maintain aspect ratio during scaling
- "targetWidth": number - Scale to this width (height auto-calculated)
- "targetHeight": number - Scale to this height (width auto-calculated)

If both targetWidth and targetHeight specified, the smaller scale wins to fit within bounds.

Example - Scale phone mockup to specific width:
{
  "nodeId": "123:456",
  "nodeName": "Phone Mockup",
  "aspectLocked": true,
  "targetWidth": 400,
  "positioning": "ABSOLUTE",
  "x": 340,
  "y": 500,
  ...
}

### Anchor Points (anchor)
Define how elements position relative to parent frame edges.
Only meaningful for absolutely positioned elements.
Useful for responsive layouts where elements should stay in corners/edges.

Properties:
- "anchor.horizontal": "LEFT" | "CENTER" | "RIGHT"
- "anchor.vertical": "TOP" | "CENTER" | "BOTTOM"

When anchored, x/y coordinates are interpreted relative to that anchor point.
Example: anchor RIGHT + x: 50 means "50px from right edge"

Example - Badge anchored to top-right corner:
{
  "nodeId": "badge-1",
  "nodeName": "Sale Badge",
  "positioning": "ABSOLUTE",
  "anchor": { "horizontal": "RIGHT", "vertical": "TOP" },
  "x": 20,
  "y": 180,
  "rotation": 15,
  "zIndex": 20,
  ...
}

### Combined Example - Dynamic Product Showcase:
{
  "nodeId": "phone-hero",
  "nodeName": "iPhone Mockup",
  "visible": true,
  "order": 0,
  "widthSizing": "FIXED",
  "heightSizing": "FIXED",
  "positioning": "ABSOLUTE",
  "x": 540,
  "y": 400,
  "rotation": -10,
  "aspectLocked": true,
  "targetWidth": 500,
  "anchor": { "horizontal": "CENTER", "vertical": "CENTER" },
  "zIndex": 10
}

## When to Apply Advanced Composition Features

IMPORTANT: Preserve the source design's existing transforms. Do NOT override rotation, scale, or positioning that already exists in the source.

### Positioning Strategy Decision
When a group has preserveSpacing: true:
- The system automatically preserves original spacing between elements
- Do NOT specify x/y coordinates on nodes in that group
- Elements will be uniformly scaled and horizontally centered

When a group has preserveSpacing: false or omitted:
- Use x/y coordinates for TikTok safe zone optimization
- AI-specified positions will place elements strategically

### Product Mockups (phones, laptops, tablets, device screens)
Apply these features to PRESERVE the mockup composition:
- positioning: "ABSOLUTE" - Remove from layout flow (ALWAYS for mockups)
- Set preserveSpacing: true on the product group if multiple mockups should maintain spacing
- DO NOT specify x/y coordinates when preserveSpacing is true
- zIndex: 10 - Layer in front of backgrounds
- DO NOT specify rotation if the mockup is already tilted in the source
- DO NOT specify aspectLocked/targetWidth if the mockup size looks correct
- Set clipContent: false if mockups should bleed off edges

IMPORTANT: When you set positioning: "ABSOLUTE" WITHOUT x/y coordinates, the original position
will be preserved and scaled proportionally to the TikTok frame. This preserves the designer's
original composition. Only specify x/y if you need to MOVE the element to a different location.

### When to use rotation
ONLY use rotation if:
- The source element is NOT already rotated, AND
- Adding a tilt would improve the composition
If the element already appears tilted/angled in the source image, DO NOT include rotation in the spec.

### When to use aspectLocked scaling
ONLY use aspectLocked/targetWidth/targetHeight if:
- The element needs to be resized to fit TikTok dimensions
- The current size is too large or too small for the target frame
If the element's current proportions work for the layout, DO NOT include scaling properties.

### Badges, Labels, Sale Tags, Stickers
- positioning: "ABSOLUTE"
- anchor: { horizontal: "RIGHT", vertical: "TOP" } - Pin to corner
- rotation: Only if not already rotated in source
- zIndex: 20 - Float above other content

### Background/Decorative Elements
- zIndex: 1 - Push behind everything else
- Consider clipContent: false if they should bleed`;

/**
 * Build the user prompt with node tree and dimensions.
 */
function buildPrompt(nodeTree: NodeTreeItem, sourceWidth: number, sourceHeight: number): string {
  // Calculate content density hint based on node count
  const nodeCount = countNodes(nodeTree);
  const densityHint = nodeCount > 15 ? "dense" : nodeCount > 8 ? "medium" : "sparse";

  return `Transform this marketing frame for TikTok vertical format (1080×1920).

## Source Frame
- Dimensions: ${sourceWidth}×${sourceHeight}px
- Aspect ratio: ${(sourceWidth / sourceHeight).toFixed(2)}
- Element count: ${nodeCount} nodes (${densityHint} density)

## Spacing Analysis
Based on source frame characteristics, calculate appropriate padding and gap values:
- ${densityHint === "dense" ? "Dense content detected - use tighter gaps (16-24px) to fit more elements" : densityHint === "medium" ? "Medium density - balanced gaps (24-32px) work well" : "Sparse/hero layout - generous gaps (32-48px) create drama"}
- Source is ${sourceWidth > sourceHeight ? "landscape (wide)" : sourceWidth < sourceHeight ? "portrait (tall)" : "square"} - adjust side padding accordingly

## Node Tree
${JSON.stringify(nodeTree, null, 2)}

## Your Analysis Steps

**Step 1: Study the source design's character**
- Is the alignment centered, left-aligned, or asymmetric?
- What's the spacing rhythm? (tight within groups, loose between sections?)
- Is the overall feel airy/spacious or compact/dense?
- What elements did the designer visually group together?

**Step 2: Identify semantic content**
- What's the hero/main message?
- What are the features/benefits?
- Where's the product imagery?
- What's the CTA?

**Step 3: Adapt for TikTok while preserving character**
- Reorder for vertical scroll priority
- Keep critical content in safe zone (avoid top 8%, bottom 35%)
- Maintain the source's alignment pattern
- Preserve spacing ratios (if items are tightly grouped, keep them tight)
- Hide only elements that truly don't work vertically

**Step 4: Apply advanced composition features (preserve existing transforms)**
- If device mockups exist: use positioning: "ABSOLUTE" to place them precisely
- LOOK at the source image: if mockups are already tilted, do NOT add rotation
- LOOK at the source image: if mockups are already sized correctly, do NOT add scaling
- Only use rotation/aspectLocked if the source element needs those transforms applied
- If mockups should bleed off edges, set clipContent: false on rootLayout
- Use zIndex to control layering (backgrounds: 1, mockups: 10, badges: 20)

**Step 5: Generate layout spec**
- Use counterAxisAlign that matches source alignment (MIN=left, CENTER=centered)
- Calculate gaps that maintain the source's spacing rhythm
- Group elements that were visually grouped in the source
- Include rotation, aspectLocked, targetWidth, and anchor for applicable elements

Return ONLY the JSON layout specification.`;
}

/**
 * Count total nodes in tree recursively.
 */
function countNodes(node: NodeTreeItem): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

/**
 * Parse the AI response into a LayoutSpec object.
 */
function parseLayoutSpec(content: string): LayoutSpec {
  console.log("[ai-service] parseLayoutSpec - input length:", content.length);

  // Try to extract JSON from the response (in case AI adds markdown)
  let jsonStr = content.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith("```")) {
    console.log("[ai-service] Detected markdown code block, stripping...");
    const lines = jsonStr.split("\n");
    lines.shift(); // Remove opening ```json or ```
    while (lines.length && !lines[lines.length - 1].startsWith("```")) {
      // Keep going
    }
    if (lines.length && lines[lines.length - 1].startsWith("```")) {
      lines.pop(); // Remove closing ```
    }
    jsonStr = lines.join("\n");
    console.log("[ai-service] After stripping markdown, length:", jsonStr.length);
  }

  try {
    const parsed = JSON.parse(jsonStr) as LayoutSpec;
    console.log("[ai-service] JSON parsed successfully");

    // Validate required fields
    if (!Array.isArray(parsed.nodes)) {
      console.error("[ai-service] Invalid spec: missing nodes array");
      throw new Error("Invalid layout spec: missing nodes array");
    }
    if (!parsed.rootLayout) {
      console.error("[ai-service] Invalid spec: missing rootLayout");
      throw new Error("Invalid layout spec: missing rootLayout");
    }

    // Log semantic groups info (optional field)
    if (parsed.semanticGroups && Array.isArray(parsed.semanticGroups)) {
      console.log("[ai-service] semanticGroups found:", parsed.semanticGroups.length);
      for (const group of parsed.semanticGroups) {
        console.log(`[ai-service]   Group ${group.groupId}: role=${group.role}, nodes=${group.nodeIds.length}, order=${group.order}, visible=${group.visible}`);
      }
    } else {
      console.log("[ai-service] No semanticGroups in response - will use nodes-only fallback");
    }

    console.log("[ai-service] Validation passed - nodes:", parsed.nodes.length);
    return parsed;
  } catch (error) {
    console.error("[ai-service] JSON parse error:", error);
    console.error("[ai-service] Failed JSON string (first 500 chars):", jsonStr.substring(0, 500));
    throw new Error(`Failed to parse layout spec: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * OpenAI API response types (simplified)
 */
interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}
