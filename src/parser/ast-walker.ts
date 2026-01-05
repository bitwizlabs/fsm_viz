import type Parser from 'web-tree-sitter';

export type SyntaxNode = Parser.SyntaxNode;

/**
 * Walk the AST and call visitor for each node.
 */
export function walkTree(
  node: SyntaxNode,
  visitor: (node: SyntaxNode) => boolean | void
): void {
  // If visitor returns true, skip children
  if (visitor(node) === true) {
    return;
  }
  for (const child of node.children) {
    walkTree(child, visitor);
  }
}

/**
 * Find all nodes of a specific type in the tree.
 */
export function findNodesOfType(root: SyntaxNode, type: string): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  walkTree(root, (node) => {
    if (node.type === type) {
      result.push(node);
    }
  });
  return result;
}

/**
 * Find the first node of a specific type.
 */
export function findFirstNodeOfType(root: SyntaxNode, type: string): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  walkTree(root, (node) => {
    if (node.type === type && !found) {
      found = node;
      return true; // Stop searching
    }
  });
  return found;
}

/**
 * Find all direct children of a specific type.
 */
export function getChildrenOfType(node: SyntaxNode, type: string): SyntaxNode[] {
  return node.children.filter((child) => child.type === type);
}

/**
 * Find the first direct child of a specific type.
 */
export function getChildOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.children.find((child) => child.type === type) || null;
}

/**
 * Get the text content of a node.
 */
export function getNodeText(node: SyntaxNode): string {
  return node.text;
}

/**
 * Get the line number of a node (1-indexed for user display).
 */
export function getNodeLine(node: SyntaxNode): number {
  return node.startPosition.row + 1;
}

/**
 * Find a named child by field name.
 */
export function getNamedChild(node: SyntaxNode, fieldName: string): SyntaxNode | null {
  return node.childForFieldName(fieldName);
}

/**
 * Find ancestor of a specific type.
 */
export function findAncestorOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  let current = node.parent;
  while (current) {
    if (current.type === type) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Check if a node is inside another node of a specific type.
 */
export function isInsideNodeOfType(node: SyntaxNode, type: string): boolean {
  return findAncestorOfType(node, type) !== null;
}

/**
 * Get all sibling nodes.
 */
export function getSiblings(node: SyntaxNode): SyntaxNode[] {
  const parent = node.parent;
  if (!parent) return [];
  return parent.children.filter((child) => child !== node);
}

/**
 * Get text content without whitespace.
 */
export function getNodeTextTrimmed(node: SyntaxNode): string {
  return node.text.trim();
}

/**
 * Check if node matches any of the given types.
 */
export function nodeIsType(node: SyntaxNode, ...types: string[]): boolean {
  return types.includes(node.type);
}

/**
 * Debug helper: print the AST structure.
 */
export function printAST(node: SyntaxNode, indent = 0): void {
  const prefix = '  '.repeat(indent);
  const text = node.text.length > 50 ? node.text.slice(0, 50) + '...' : node.text;
  console.log(`${prefix}${node.type}: "${text.replace(/\n/g, '\\n')}"`);
  for (const child of node.children) {
    printAST(child, indent + 1);
  }
}

/**
 * Get a compact representation of the AST for debugging.
 */
export function getASTSummary(node: SyntaxNode, maxDepth = 3, depth = 0): string {
  if (depth >= maxDepth) {
    return `${node.type}[...]`;
  }

  const children = node.children.map((c) => getASTSummary(c, maxDepth, depth + 1));

  if (children.length === 0) {
    const text = node.text.length > 20 ? node.text.slice(0, 20) + '...' : node.text;
    return `${node.type}:"${text}"`;
  }

  return `${node.type}(${children.join(', ')})`;
}
