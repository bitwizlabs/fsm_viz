import type { SyntaxNode } from '../parser/ast-walker.js';
import {
  walkTree,
  findNodesOfType,
  getNodeText,
  getNodeLine,
} from '../parser/ast-walker.js';
import type { FSMTransition, FSMOutput, CaseItem, Assignment, ConditionalBlock } from '../types.js';

/**
 * Extract transitions from a case statement on the state variable.
 */
export function extractTransitions(
  caseStmt: SyntaxNode,
  stateVarName: string,
  nextStateVarName: string,
  stateNames: Set<string>,
  sourceBlock: 'always_ff' | 'always_comb' | 'always'
): { transitions: FSMTransition[]; hasDefaultAssignment: boolean } {
  const transitions: FSMTransition[] = [];
  let hasDefaultAssignment = false;

  // Check for default assignment before case statement
  // Pattern: next_state = state; (at the beginning of always_comb)
  const parent = caseStmt.parent;
  if (parent) {
    const parentText = getNodeText(parent);
    const defaultPattern = new RegExp(`${nextStateVarName}\\s*=\\s*${stateVarName}\\s*;`);
    if (defaultPattern.test(parentText)) {
      hasDefaultAssignment = true;
    }
  }

  // Extract case items
  const caseItems = extractCaseItems(caseStmt, stateNames, nextStateVarName);

  // Process each case item
  for (const item of caseItems) {
    const itemTransitions = processCaseItem(
      item,
      nextStateVarName,
      stateNames,
      sourceBlock,
      hasDefaultAssignment
    );
    transitions.push(...itemTransitions);
  }

  // Add implicit self-loops if default assignment pattern detected
  if (hasDefaultAssignment) {
    const explicitFromStates = new Set(transitions.map((t) => t.from));
    for (const state of stateNames) {
      // Check if this state has no explicit handling
      const stateTransitions = transitions.filter((t) => t.from === state);
      if (stateTransitions.length === 0) {
        // Add implicit self-loop
        transitions.push({
          from: state,
          to: state,
          line: getNodeLine(caseStmt),
          isDefault: true,
          isSelfLoop: true,
          isImplicit: true,
          sourceBlock,
          outputs: [],
        });
      }
    }
  }

  return { transitions, hasDefaultAssignment };
}

/**
 * Extract case items from a case statement.
 */
function extractCaseItems(
  caseStmt: SyntaxNode,
  stateNames: Set<string>,
  nextStateVarName: string
): CaseItem[] {
  const items: CaseItem[] = [];
  const text = getNodeText(caseStmt);

  // Find case_item nodes
  const caseItemNodes = findNodesOfType(caseStmt, 'case_item');

  for (const itemNode of caseItemNodes) {
    const itemText = getNodeText(itemNode);
    const line = getNodeLine(itemNode);

    // Extract the case label(s)
    const labels = extractCaseLabels(itemNode, itemText, stateNames);

    for (const label of labels) {
      // Extract assignments and conditions from this item
      const { assignments, conditions } = extractAssignmentsAndConditions(
        itemNode,
        itemText,
        nextStateVarName
      );

      items.push({
        label,
        line,
        assignments,
        conditions,
      });
    }
  }

  // Handle default case
  const defaultMatch = text.match(/default\s*:/i);
  if (defaultMatch) {
    // Find the default case item
    const defaultItem = caseItemNodes.find((n) =>
      getNodeText(n).toLowerCase().includes('default')
    );
    if (defaultItem) {
      const { assignments, conditions } = extractAssignmentsAndConditions(
        defaultItem,
        getNodeText(defaultItem),
        nextStateVarName
      );
      items.push({
        label: 'default',
        line: getNodeLine(defaultItem),
        assignments,
        conditions,
      });
    }
  }

  return items;
}

/**
 * Extract case labels from a case item.
 */
function extractCaseLabels(
  itemNode: SyntaxNode,
  itemText: string,
  stateNames: Set<string>
): string[] {
  const labels: string[] = [];

  // Try to find identifier at the start of the case item
  // Pattern: STATE_NAME: or STATE1, STATE2:
  const colonIndex = itemText.indexOf(':');
  if (colonIndex > 0) {
    const labelPart = itemText.substring(0, colonIndex);

    // Check for multiple labels separated by comma
    const potentialLabels = labelPart.split(',').map((l) => l.trim());

    for (const label of potentialLabels) {
      // Check if this is a known state name
      if (stateNames.has(label)) {
        labels.push(label);
      } else if (label.toLowerCase() === 'default') {
        labels.push('default');
      } else {
        // Try to extract identifier
        const match = label.match(/\b([A-Z_][A-Z0-9_]*)\b/);
        if (match && stateNames.has(match[1])) {
          labels.push(match[1]);
        }
      }
    }
  }

  return labels;
}

/**
 * Extract assignments and conditions from a case item.
 */
function extractAssignmentsAndConditions(
  itemNode: SyntaxNode,
  itemText: string,
  nextStateVarName: string
): { assignments: Assignment[]; conditions: ConditionalBlock[] } {
  const assignments: Assignment[] = [];
  const conditions: ConditionalBlock[] = [];

  // Find direct assignments (not inside if)
  const assignmentPattern = new RegExp(
    `(\\w+)\\s*(<=|=)\\s*([^;]+);`,
    'g'
  );

  // First, extract if/else blocks
  const ifBlocks = extractIfBlocks(itemNode, itemText, nextStateVarName);
  conditions.push(...ifBlocks);

  // Then find direct assignments (outside of if blocks)
  // This is a simplification - we look for assignments in the text
  let match;
  const processedText = removeIfBlocks(itemText);

  while ((match = assignmentPattern.exec(processedText)) !== null) {
    const target = match[1];
    const isBlocking = match[2] === '=';
    const value = match[3].trim();

    assignments.push({
      target,
      value,
      line: getNodeLine(itemNode),
      isBlocking,
    });
  }

  return { assignments, conditions };
}

/**
 * Extract if/else blocks from a case item.
 */
function extractIfBlocks(
  itemNode: SyntaxNode,
  itemText: string,
  nextStateVarName: string
): ConditionalBlock[] {
  const blocks: ConditionalBlock[] = [];

  // Look for conditional_statement nodes
  const ifNodes = findNodesOfType(itemNode, 'conditional_statement');

  for (const ifNode of ifNodes) {
    const block = parseConditionalBlock(ifNode, nextStateVarName);
    if (block) {
      blocks.push(block);
    }
  }

  // Fallback: parse from text using regex
  if (blocks.length === 0 && itemText.includes('if')) {
    const textBlocks = parseIfBlocksFromText(itemText, nextStateVarName, getNodeLine(itemNode));
    blocks.push(...textBlocks);
  }

  return blocks;
}

/**
 * Parse a conditional_statement node into a ConditionalBlock.
 */
function parseConditionalBlock(
  ifNode: SyntaxNode,
  nextStateVarName: string
): ConditionalBlock | null {
  const text = getNodeText(ifNode);
  const line = getNodeLine(ifNode);

  // Extract condition
  const condMatch = text.match(/if\s*\(([^)]+)\)/i);
  if (!condMatch) {
    return null;
  }

  const condition = condMatch[1].trim();

  // Find assignments in the if branch
  const assignments = extractAssignmentsFromText(text, line);

  // Look for else branch
  let elseAssignments: Assignment[] | undefined;
  let nestedConditions: ConditionalBlock[] | undefined;

  const elseMatch = text.match(/\belse\b/i);
  if (elseMatch) {
    // Check for else if
    const elseIfMatch = text.match(/else\s+if\s*\(/i);
    if (elseIfMatch) {
      // Has nested else if - parse recursively
      nestedConditions = [];
      const nestedIfNodes = findNodesOfType(ifNode, 'conditional_statement');
      for (const nested of nestedIfNodes) {
        if (nested !== ifNode) {
          const nestedBlock = parseConditionalBlock(nested, nextStateVarName);
          if (nestedBlock) {
            nestedConditions.push(nestedBlock);
          }
        }
      }
    } else {
      // Plain else
      const elseIndex = text.indexOf('else');
      const elseText = text.substring(elseIndex + 4);
      elseAssignments = extractAssignmentsFromText(elseText, line);
    }
  }

  return {
    condition,
    assignments,
    elseAssignments,
    nestedConditions,
    line,
  };
}

/**
 * Parse if blocks from text (fallback).
 */
function parseIfBlocksFromText(
  text: string,
  nextStateVarName: string,
  baseLine: number
): ConditionalBlock[] {
  const blocks: ConditionalBlock[] = [];

  // Simple if pattern: if (condition) next_state = VALUE;
  const simpleIfPattern = /if\s*\(([^)]+)\)\s*(?:begin\s*)?(\w+)\s*(<=|=)\s*(\w+)\s*;/gi;

  let match;
  while ((match = simpleIfPattern.exec(text)) !== null) {
    const condition = match[1].trim();
    const target = match[2];
    const isBlocking = match[3] === '=';
    const value = match[4];

    blocks.push({
      condition,
      assignments: [{
        target,
        value,
        line: baseLine,
        isBlocking,
      }],
      line: baseLine,
    });
  }

  return blocks;
}

/**
 * Extract assignments from text.
 */
function extractAssignmentsFromText(text: string, baseLine: number): Assignment[] {
  const assignments: Assignment[] = [];
  const pattern = /(\w+)\s*(<=|=)\s*([^;]+);/g;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    assignments.push({
      target: match[1],
      value: match[3].trim(),
      line: baseLine,
      isBlocking: match[2] === '=',
    });
  }

  return assignments;
}

/**
 * Remove if blocks from text for finding direct assignments.
 */
function removeIfBlocks(text: string): string {
  // Remove content between 'if' and matching 'end' or semicolon
  // This is a simplification
  return text.replace(/if\s*\([^)]+\)\s*begin[\s\S]*?end/gi, '')
             .replace(/if\s*\([^)]+\)\s*[^;]+;/gi, '')
             .replace(/else\s*begin[\s\S]*?end/gi, '')
             .replace(/else\s*[^;]+;/gi, '');
}

/**
 * Process a case item to extract transitions.
 */
function processCaseItem(
  item: CaseItem,
  nextStateVarName: string,
  stateNames: Set<string>,
  sourceBlock: 'always_ff' | 'always_comb' | 'always',
  hasDefaultAssignment: boolean
): FSMTransition[] {
  const transitions: FSMTransition[] = [];
  const fromState = item.label;

  if (fromState === 'default') {
    return transitions; // Handle default separately
  }

  // Process direct assignments
  for (const assign of item.assignments) {
    if (assign.target === nextStateVarName || isStateAssignment(assign.target, nextStateVarName)) {
      const toState = assign.value;
      if (stateNames.has(toState)) {
        transitions.push({
          from: fromState,
          to: toState,
          line: assign.line,
          isSelfLoop: fromState === toState,
          sourceBlock,
          outputs: [],
        });
      }
    }
  }

  // Process conditional transitions
  for (const cond of item.conditions) {
    const condTransitions = processConditionalBlock(
      cond,
      fromState,
      nextStateVarName,
      stateNames,
      sourceBlock,
      '',
      hasDefaultAssignment
    );
    transitions.push(...condTransitions);
  }

  // If no explicit transitions and has default assignment, add implicit self-loop
  if (transitions.length === 0 && hasDefaultAssignment) {
    transitions.push({
      from: fromState,
      to: fromState,
      line: item.line,
      isDefault: true,
      isSelfLoop: true,
      isImplicit: true,
      sourceBlock,
      outputs: [],
    });
  }

  return transitions;
}

/**
 * Process a conditional block to extract transitions.
 */
function processConditionalBlock(
  cond: ConditionalBlock,
  fromState: string,
  nextStateVarName: string,
  stateNames: Set<string>,
  sourceBlock: 'always_ff' | 'always_comb' | 'always',
  accumulatedCondition: string,
  hasDefaultAssignment: boolean
): FSMTransition[] {
  const transitions: FSMTransition[] = [];

  // Build the full condition
  const fullCondition = accumulatedCondition
    ? `${accumulatedCondition} && ${cond.condition}`
    : cond.condition;

  // Find state assignment in if branch
  for (const assign of cond.assignments) {
    if (assign.target === nextStateVarName || isStateAssignment(assign.target, nextStateVarName)) {
      const toState = assign.value;
      if (stateNames.has(toState)) {
        transitions.push({
          from: fromState,
          to: toState,
          condition: simplifyCondition(fullCondition),
          rawCondition: fullCondition,
          line: assign.line,
          isSelfLoop: fromState === toState,
          sourceBlock,
          outputs: [],
        });
      }
    }
  }

  // Process else branch
  if (cond.elseAssignments && cond.elseAssignments.length > 0) {
    const elseCondition = accumulatedCondition
      ? `${accumulatedCondition} && !(${cond.condition})`
      : `!(${cond.condition})`;

    for (const assign of cond.elseAssignments) {
      if (assign.target === nextStateVarName || isStateAssignment(assign.target, nextStateVarName)) {
        const toState = assign.value;
        if (stateNames.has(toState)) {
          transitions.push({
            from: fromState,
            to: toState,
            condition: simplifyCondition(elseCondition),
            rawCondition: elseCondition,
            line: assign.line,
            isSelfLoop: fromState === toState,
            sourceBlock,
            outputs: [],
          });
        }
      }
    }
  }

  // Process nested conditions (else if)
  if (cond.nestedConditions) {
    const negatedCurrent = accumulatedCondition
      ? `${accumulatedCondition} && !(${cond.condition})`
      : `!(${cond.condition})`;

    for (const nested of cond.nestedConditions) {
      const nestedTransitions = processConditionalBlock(
        nested,
        fromState,
        nextStateVarName,
        stateNames,
        sourceBlock,
        negatedCurrent,
        hasDefaultAssignment
      );
      transitions.push(...nestedTransitions);
    }
  }

  return transitions;
}

/**
 * Check if a variable is a state assignment target.
 */
function isStateAssignment(target: string, nextStateVarName: string): boolean {
  return target === nextStateVarName ||
         target.toLowerCase().includes('state') ||
         target.toLowerCase() === 'ns' ||
         target.toLowerCase() === 'next';
}

/**
 * Simplify a condition string.
 */
export function simplifyCondition(condition: string): string {
  // Basic simplifications
  let simplified = condition
    .replace(/\s+/g, ' ')
    .trim()
    // Remove redundant parentheses around single terms
    .replace(/\((\w+)\)/g, '$1')
    // Simplify !!x to x
    .replace(/!!\s*(\w+)/g, '$1')
    // Simplify !(!x) to x
    .replace(/!\s*\(\s*!\s*(\w+)\s*\)/g, '$1');

  return simplified;
}

/**
 * Extract reset state from always_ff block.
 */
export function extractResetState(
  alwaysNode: SyntaxNode,
  stateVarName: string,
  stateNames: Set<string>
): string | null {
  const text = getNodeText(alwaysNode);

  // Look for reset pattern: if (!rst_n) state <= IDLE;
  const resetPatterns = [
    // Active low: if (!rst_n) state <= STATE;
    new RegExp(`if\\s*\\(\\s*[!~]\\s*\\w+\\s*\\)\\s*(?:begin\\s*)?${stateVarName}\\s*<=\\s*(\\w+)`, 'i'),
    // Active high: if (rst) state <= STATE;
    new RegExp(`if\\s*\\(\\s*\\w+\\s*\\)\\s*(?:begin\\s*)?${stateVarName}\\s*<=\\s*(\\w+)`, 'i'),
    // With comparison: if (rst == 1'b0) state <= STATE;
    new RegExp(`if\\s*\\([^)]+\\)\\s*(?:begin\\s*)?${stateVarName}\\s*<=\\s*(\\w+)`, 'i'),
  ];

  for (const pattern of resetPatterns) {
    const match = text.match(pattern);
    if (match) {
      const resetState = match[1];
      if (stateNames.has(resetState)) {
        return resetState;
      }
    }
  }

  // Fallback: return first state in enum
  return null;
}
