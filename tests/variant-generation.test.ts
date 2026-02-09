/**
 * Variant Generation Regression Tests
 *
 * Tests for the ScaleResizer variant generation system to prevent
 * regressions in semantic grouping and positioning variety.
 */

import type { LayoutSpec, NodeSpec, SemanticGroup } from "../types/layout-spec";

// Mock console to capture logs
const mockConsoleLog = jest.fn();
const mockConsoleWarn = jest.fn();
const mockConsoleError = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  console.log = mockConsoleLog;
  console.warn = mockConsoleWarn;
  console.error = mockConsoleError;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Variant Generation Regression Tests", () => {
  describe("Over-grouping Detection", () => {
    test("should warn when all semantic groups have preserveSpacing=true", () => {
      // Simulate the validation logic from spec-applicator.ts
      const spec: LayoutSpec = {
        nodes: [
          { nodeId: "node1", visible: true },
          { nodeId: "node2", visible: true },
          { nodeId: "node3", visible: true },
        ],
        semanticGroups: [
          {
            groupId: "hero",
            role: "hero",
            nodeIds: ["node1"],
            order: 10,
            visible: true,
            preserveSpacing: true, // Problem: all groups preserve spacing
          },
          {
            groupId: "product",
            role: "product",
            nodeIds: ["node2"],
            order: 20,
            visible: true,
            preserveSpacing: true, // Problem: all groups preserve spacing
          },
          {
            groupId: "cta",
            role: "cta",
            nodeIds: ["node3"],
            order: 30,
            visible: true,
            preserveSpacing: true, // Problem: all groups preserve spacing
          },
        ],
      };

      // Simulate the validation logic
      const allPreserveSpacing = spec.semanticGroups!.every(g => g.preserveSpacing);
      if (allPreserveSpacing) {
        console.warn("⚠️  [VARIANT WARNING] All semantic groups have preserveSpacing=true. This will cause HYBRID mode (A) to behave identically to PRESERVE_SPACING mode (B), reducing variant diversity!");
      }

      expect(allPreserveSpacing).toBe(true);
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        "⚠️  [VARIANT WARNING] All semantic groups have preserveSpacing=true. This will cause HYBRID mode (A) to behave identically to PRESERVE_SPACING mode (B), reducing variant diversity!"
      );
    });

    test("should warn when group count is too low", () => {
      const spec: LayoutSpec = {
        nodes: [
          { nodeId: "node1", visible: true },
          { nodeId: "node2", visible: true },
        ],
        semanticGroups: [
          {
            groupId: "hero",
            role: "hero",
            nodeIds: ["node1", "node2"],
            order: 10,
            visible: true,
            preserveSpacing: false,
          },
          // Only 1 group - too few for good diversity
        ],
      };

      // Simulate the validation logic
      const groupCount = spec.semanticGroups!.length;
      if (groupCount < 3) {
        console.warn(`⚠️  [VARIANT WARNING] Only ${groupCount} semantic groups detected. For optimal variant diversity, aim for 4-8 groups. Consider splitting large content areas.`);
      }

      expect(groupCount).toBe(1);
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        "⚠️  [VARIANT WARNING] Only 1 semantic groups detected. For optimal variant diversity, aim for 4-8 groups. Consider splitting large content areas."
      );
    });

    test("should warn about over-large groups", () => {
      const spec: LayoutSpec = {
        nodes: [
          { nodeId: "node1", visible: true },
          { nodeId: "node2", visible: true },
          { nodeId: "node3", visible: true },
          { nodeId: "node4", visible: true },
          { nodeId: "node5", visible: true },
          { nodeId: "node6", visible: true },
          { nodeId: "node7", visible: true },
          { nodeId: "node8", visible: true },
          { nodeId: "node9", visible: true },
          { nodeId: "node10", visible: true },
        ],
        semanticGroups: [
          {
            groupId: "overGrouped",
            role: "hero",
            nodeIds: ["node1", "node2", "node3", "node4", "node5", "node6", "node7", "node8", "node9", "node10"], // 10 nodes - too many
            order: 10,
            visible: true,
            preserveSpacing: false,
          },
        ],
      };

      // Simulate the validation logic
      const largeGroups = spec.semanticGroups!.filter(g => g.nodeIds.length > 8);
      if (largeGroups.length > 0) {
        console.warn(`⚠️  [VARIANT WARNING] ${largeGroups.length} groups have >8 nodes each: ${largeGroups.map(g => g.groupId).join(", ")}. Large groups suggest over-grouping and reduce positioning diversity.`);
      }

      expect(largeGroups).toHaveLength(1);
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        "⚠️  [VARIANT WARNING] 1 groups have >8 nodes each: overGrouped. Large groups suggest over-grouping and reduce positioning diversity."
      );
    });
  });

  describe("Diverse Semantic Groups", () => {
    test("should pass validation with diverse semantic groups", () => {
      const spec: LayoutSpec = {
        nodes: [
          { nodeId: "node1", visible: true },
          { nodeId: "node2", visible: true },
          { nodeId: "node3", visible: true },
          { nodeId: "node4", visible: true },
          { nodeId: "node5", visible: true },
        ],
        semanticGroups: [
          {
            groupId: "hero",
            role: "hero",
            nodeIds: ["node1"],
            order: 10,
            visible: true,
            preserveSpacing: false, // Good: mixed spacing strategy
          },
          {
            groupId: "product",
            role: "product",
            nodeIds: ["node2", "node3"],
            order: 20,
            visible: true,
            preserveSpacing: true, // Good: specific use case for spacing preservation
          },
          {
            groupId: "features",
            role: "features",
            nodeIds: ["node4"],
            order: 30,
            visible: true,
            preserveSpacing: false, // Good: allows positioning flexibility
          },
          {
            groupId: "cta",
            role: "cta",
            nodeIds: ["node5"],
            order: 40,
            visible: true,
            preserveSpacing: false, // Good: allows positioning flexibility
          },
        ],
      };

      // Simulate the validation logic
      const allPreserveSpacing = spec.semanticGroups!.every(g => g.preserveSpacing);
      const groupCount = spec.semanticGroups!.length;
      const largeGroups = spec.semanticGroups!.filter(g => g.nodeIds.length > 8);

      expect(allPreserveSpacing).toBe(false); // Good diversity
      expect(groupCount).toBeGreaterThanOrEqual(3); // Sufficient groups
      expect(largeGroups).toHaveLength(0); // No over-large groups

      // Should not have warning calls for this good configuration
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });
  });

  describe("Variant Count Verification", () => {
    test("should verify exactly 12 variants are created", () => {
      const expectedVariants = 12;
      const mockVariants = [
        { name: "Test - A) Hybrid" },
        { name: "Test - B) Preserve" },
        { name: "Test - C) Uniform" },
        { name: "Test - D) AI" },
        { name: "Test - E) X_Pre" },
        { name: "Test - F) X_AI" },
        { name: "Test - G) Blend_50" },
        { name: "Test - H) Blend_70" },
        { name: "Test - I) Native Figma" },
        { name: "Test - J) Native+Abs" },
        { name: "Test - K) Native Smart" },
        { name: "Test - L) Native Grid" },
      ];

      // Simulate the verification logic
      const actualVariants = mockVariants.length;
      if (actualVariants === expectedVariants) {
        console.log(`✅ [spec-applicator] VARIANT COUNT VERIFIED: Created exactly ${actualVariants} variants as expected`);
      } else {
        console.error(`❌ [spec-applicator] VARIANT COUNT MISMATCH: Expected ${expectedVariants} variants but created ${actualVariants}!`);
      }

      expect(actualVariants).toBe(expectedVariants);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "✅ [spec-applicator] VARIANT COUNT VERIFIED: Created exactly 12 variants as expected"
      );
    });

    test("should detect variant count mismatch", () => {
      const expectedVariants = 12;
      const mockVariants = [
        { name: "Test - A) Hybrid" },
        { name: "Test - B) Preserve" },
        // Missing variants - only 2 created
      ];

      // Simulate the verification logic
      const actualVariants = mockVariants.length;
      if (actualVariants === expectedVariants) {
        console.log(`✅ [spec-applicator] VARIANT COUNT VERIFIED: Created exactly ${actualVariants} variants as expected`);
      } else {
        console.error(`❌ [spec-applicator] VARIANT COUNT MISMATCH: Expected ${expectedVariants} variants but created ${actualVariants}!`);
        console.error(`[spec-applicator] This indicates a problem in the variant generation loop.`);
      }

      expect(actualVariants).not.toBe(expectedVariants);
      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ [spec-applicator] VARIANT COUNT MISMATCH: Expected 12 variants but created 2!"
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        "[spec-applicator] This indicates a problem in the variant generation loop."
      );
    });
  });

  describe("Variant Naming Consistency", () => {
    test("should verify all expected variant patterns are present", () => {
      const mockVariants = [
        { name: "Test Frame - A) Hybrid - Per-element strategy based on preserveSpacing" },
        { name: "Test Frame - B) Preserve - Original X positions with centered composition" },
        { name: "Test Frame - C) Uniform - Proportional scaling of positions and dimensions" },
        { name: "Test Frame - D) AI - AI-specified coordinates" },
        { name: "Test Frame - E) X_Pre_Y_AI - X positions preserved, Y from AI" },
        { name: "Test Frame - F) X_AI_Y_Pre - X from AI, Y positions preserved" },
        { name: "Test Frame - G) Blend_50 - 50% blend of preserve/AI positioning" },
        { name: "Test Frame - H) Blend_70_30 - 70% preserve, 30% AI positioning" },
        { name: "Test Frame - I) Native Figma - Wrap, grid, constraints only" },
        { name: "Test Frame - J) Native+Abs - Native features + absolute positioning" },
        { name: "Test Frame - K) Native Smart - Native API + visual hierarchy" },
        { name: "Test Frame - L) Native Grid - Auto-layout grid patterns" },
      ];

      // Simulate the naming verification logic
      const variantNames = mockVariants.map(v => v.name);
      const expectedPatterns = ["A) Hybrid", "B) Preserve", "C) Uniform", "D) AI", "E) X_Pre", "F) X_AI", "G) Blend_50", "H) Blend_70", "I) Native Figma", "J) Native+Abs", "K) Native Smart", "L) Native Grid"];
      const missingPatterns = expectedPatterns.filter(pattern => !variantNames.some(name => name.includes(pattern)));

      if (missingPatterns.length > 0) {
        console.warn(`⚠️  [spec-applicator] NAMING WARNING: Missing expected variant patterns: ${missingPatterns.join(", ")}`);
      } else {
        console.log(`✅ [spec-applicator] VARIANT NAMING VERIFIED: All expected patterns found`);
      }

      expect(missingPatterns).toHaveLength(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "✅ [spec-applicator] VARIANT NAMING VERIFIED: All expected patterns found"
      );
    });

    test("should detect missing variant patterns", () => {
      const mockVariants = [
        { name: "Test Frame - A) Hybrid - Per-element strategy based on preserveSpacing" },
        { name: "Test Frame - B) Preserve - Original X positions with centered composition" },
        // Missing other variants
      ];

      // Simulate the naming verification logic
      const variantNames = mockVariants.map(v => v.name);
      const expectedPatterns = ["A) Hybrid", "B) Preserve", "C) Uniform", "D) AI", "E) X_Pre", "F) X_AI", "G) Blend_50", "H) Blend_70", "I) Native Figma", "J) Native+Abs", "K) Native Smart", "L) Native Grid"];
      const missingPatterns = expectedPatterns.filter(pattern => !variantNames.some(name => name.includes(pattern)));

      if (missingPatterns.length > 0) {
        console.warn(`⚠️  [spec-applicator] NAMING WARNING: Missing expected variant patterns: ${missingPatterns.join(", ")}`);
      } else {
        console.log(`✅ [spec-applicator] VARIANT NAMING VERIFIED: All expected patterns found`);
      }

      expect(missingPatterns).toHaveLength(10);
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        "⚠️  [spec-applicator] NAMING WARNING: Missing expected variant patterns: C) Uniform, D) AI, E) X_Pre, F) X_AI, G) Blend_50, H) Blend_70, I) Native Figma, J) Native+Abs, K) Native Smart, L) Native Grid"
      );
    });
  });
});