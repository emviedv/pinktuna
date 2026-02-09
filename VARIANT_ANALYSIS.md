# Variant Performance Analysis

## Why "Top" Variants (A, D, K) Produce Worse Layouts

### Problem 1: Variant A (HYBRID) — absolute positioning is a dead code path

`applyAbsolutePositioning` (spec-applicator.ts:1190-1221) has three consecutive
filters that skip nearly every node:

1. `spec.positioning !== "ABSOLUTE"` — only processes nodes the AI explicitly
   marked ABSOLUTE. Most stay AUTO by default.
2. `node.parent.id !== frame.id` — skips anything that isn't a direct root child.
   After `convertToAutoLayout` and `applySemanticGrouping`, most nodes are nested.
3. `hasAutoLayout || hasChildren` — skips any FRAME with children or auto-layout.

The HYBRID per-group `preserveSpacing` logic (lines 1499-1537) almost never
executes. Output is just `applyModeSpecificLayout` settings (gap=16, top-aligned).

### Problem 2: Variant D (AI_DETERMINED) — AI coordinates discarded

Same filtering. AI `spec.x`/`spec.y` (line 1486) only apply to nodes passing all
three filters. For typical marketing frames, zero nodes qualify. GPT-4o coordinates
are thrown away.

### Problem 3: Variant K (NATIVE_SMART) — stale IDs break role lookup

Execution order:
1. `convertToAutoLayout()` — changes node IDs (line 276-287)
2. `applySemanticGrouping()` — uses original IDs
3. `applyNativeSmartLayout()` — builds `nodeToRole` from original semantic group IDs

After step 1 changes IDs, the role lookup (line 2435) returns "unknown" for most
children, falling through to the default case (90% width) on every element.

## What Actually Produces Better Output

Simpler variants that don't fight themselves:

- **B (Preserve)** / **C (Uniform)**: Clean auto-layout settings applied by
  `applyModeSpecificLayout`. No dead code paths.
- **I (Native Figma)**: Genuinely different — HORIZONTAL + WRAP layout mode.
- **L (Native Grid)**: GRID layoutMode is distinct from auto-layout pipeline.

## Corrected Ranking By Actual Output Quality

| Rank | Variant | Why |
|------|---------|-----|
| 1 | B) Preserve Gap | Clean centered auto-layout, gap=24 |
| 2 | C) Uniform All | Space-between works well, gap=32 |
| 3 | I) Native Figma | Genuinely different WRAP layout |
| 4 | G) 50/50 Blend | Large gap=48 gives breathing room |
| 5 | H) 70A/30D | Compact gap=8, works for dense content |
| 6 | L) Native Grid | Distinct but wrong format for TikTok |
| 7 | A) Hybrid | Promised adaptive, delivers generic gap=16 |
| 8 | D) AI Position | AI coords wasted, just gap=12 bottom |
| 9 | E) A's X + D's Y | Left-aligned + dead positioning |
| 10 | F) D's X + A's Y | Right-aligned + dead positioning |
| 11 | J) Native+Abs | WRAP then absolute = conflicting layout |
| 12 | K) Native Smart | Role lookup broken by stale IDs |

## Key Fixes Needed

1. **Fix ID remapping**: After `convertToAutoLayout`, remap semantic group nodeIds
   so downstream functions (absolute positioning, native smart) use current IDs.
2. **Relax absolute positioning filters**: Allow containers in auto-layout to be
   repositioned, not just leaf direct-children.
3. **Move `applyModeSpecificLayout` after positioning**: Currently it runs before
   the positioning function, which can overwrite its settings (Native modes) or
   set settings that get ignored (A-H modes where absolute positioning was supposed
   to be the differentiator).
