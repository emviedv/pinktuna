/**
 * Selection Module
 *
 * Handles extracting the selected frame and building a node tree
 * representation for AI analysis.
 */

import type { NodeTreeItem } from "../types/layout-spec";

/**
 * Get the currently selected frame node.
 * Returns null if selection is invalid (not exactly one frame).
 * @deprecated Use getSelectedFrames() for multi-frame support
 */
export function getSelectedFrame(): FrameNode | null {
  const frames = getSelectedFrames();
  return frames.length === 1 ? frames[0] : null;
}

/**
 * Get all currently selected frame nodes.
 * Filters out non-frame selections and returns valid frames.
 * Returns empty array if no valid frames are selected.
 */
export function getSelectedFrames(): FrameNode[] {
  const selection = figma.currentPage.selection;
  console.log("[selection] getSelectedFrames - selection count:", selection.length);

  if (selection.length === 0) {
    console.log("[selection] No nodes selected");
    return [];
  }

  // Filter to only FRAME nodes
  const frames = selection.filter((node): node is FrameNode => {
    if (node.type !== "FRAME") {
      console.log("[selection] Skipping non-frame:", node.type, node.name);
      return false;
    }
    return true;
  });

  console.log("[selection] Valid frames selected:", frames.length);
  for (const frame of frames) {
    console.log("[selection]   -", frame.name, "id:", frame.id, "size:", frame.width, "x", frame.height);
  }

  return frames;
}

/**
 * Build a simplified node tree from a frame for AI analysis.
 * Only includes relevant properties: id, name, type, dimensions, children.
 */
export function buildNodeTree(node: SceneNode, maxDepth: number = 5): NodeTreeItem {
  console.log("[selection] buildNodeTree - node:", node.name, "type:", node.type, "depth remaining:", maxDepth);

  const item: NodeTreeItem = {
    id: node.id,
    name: node.name,
    type: node.type,
    width: "width" in node ? node.width : 0,
    height: "height" in node ? node.height : 0,
  };

  // Capture layout mode for frames
  if (node.type === "FRAME") {
    const frameNode = node as FrameNode;
    item.layoutMode = frameNode.layoutMode;
    console.log("[selection] Frame", node.name, "layoutMode:", frameNode.layoutMode);
  }

  // Mark groups (they cannot have auto-layout and need conversion to frames)
  if (node.type === "GROUP") {
    item.isGroup = true;
    console.log("[selection] Group detected:", node.name);
  }

  // Recurse into children for container types
  if (maxDepth > 0 && "children" in node) {
    const children = node.children as readonly SceneNode[];
    console.log("[selection] Node", node.name, "has", children.length, "children");
    if (children.length > 0) {
      item.children = children.map((child) => buildNodeTree(child, maxDepth - 1));
    }
  }

  return item;
}

/**
 * Flatten a node tree into a list of all nodes with their IDs.
 * Useful for mapping AI specs back to actual Figma nodes.
 */
export function flattenNodeTree(tree: NodeTreeItem): NodeTreeItem[] {
  const result: NodeTreeItem[] = [tree];

  if (tree.children) {
    for (const child of tree.children) {
      result.push(...flattenNodeTree(child));
    }
  }

  console.log("[selection] flattenNodeTree - total nodes:", result.length);
  return result;
}

/**
 * Count total nodes in a tree (for AI context hints).
 */
export function countNodesInTree(tree: NodeTreeItem): number {
  let count = 1;
  if (tree.children) {
    for (const child of tree.children) {
      count += countNodesInTree(child);
    }
  }
  return count;
}
