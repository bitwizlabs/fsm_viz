import type { SyntaxNode } from '../parser/ast-walker.js';
import {
  walkTree,
  findNodesOfType,
  getNodeText,
  getNodeLine,
} from '../parser/ast-walker.js';
import type { FSMOutput, FSMTransition, CaseItem, Assignment, ConditionalBlock } from '../types.js';

/**
 * Extract Moore outputs from a case item.
 *
 * Moore outputs are unconditional assignments within a state (not inside if blocks).
 * They depend only on the current state, not on inputs.
 */
export function extractMooreOutputs(
  caseItem: CaseItem,
  stateVarName: string,
  nextStateVarName: string
): FSMOutput[] {
  const outputs: FSMOutput[] = [];
  const stateVars = new Set([stateVarName, nextStateVarName]);

  // Direct assignments that are NOT to state variables are Moore outputs
  for (const assign of caseItem.assignments) {
    if (!stateVars.has(assign.target)) {
      outputs.push({
        signal: assign.target,
        value: assign.value,
        line: assign.line,
      });
    }
  }

  return outputs;
}

/**
 * Extract Mealy outputs from a conditional block.
 *
 * Mealy outputs are assignments inside if blocks that also contain state transitions.
 * They depend on both the current state AND input conditions.
 */
export function extractMealyOutputs(
  cond: ConditionalBlock,
  stateVarName: string,
  nextStateVarName: string
): FSMOutput[] {
  const outputs: FSMOutput[] = [];
  const stateVars = new Set([stateVarName, nextStateVarName]);

  // Check if this conditional block contains a state transition
  const hasTransition = cond.assignments.some((a) => stateVars.has(a.target));

  if (hasTransition) {
    // Assignments to non-state variables are Mealy outputs
    for (const assign of cond.assignments) {
      if (!stateVars.has(assign.target)) {
        outputs.push({
          signal: assign.target,
          value: assign.value,
          line: assign.line,
        });
      }
    }
  }

  // Also check else branch
  if (cond.elseAssignments) {
    const elseHasTransition = cond.elseAssignments.some((a) => stateVars.has(a.target));
    if (elseHasTransition) {
      for (const assign of cond.elseAssignments) {
        if (!stateVars.has(assign.target)) {
          outputs.push({
            signal: assign.target,
            value: assign.value,
            line: assign.line,
          });
        }
      }
    }
  }

  // Process nested conditions
  if (cond.nestedConditions) {
    for (const nested of cond.nestedConditions) {
      const nestedOutputs = extractMealyOutputs(nested, stateVarName, nextStateVarName);
      outputs.push(...nestedOutputs);
    }
  }

  return outputs;
}

/**
 * Extract all outputs from a case statement.
 */
export function extractOutputsFromCaseStatement(
  caseStmt: SyntaxNode,
  stateVarName: string,
  nextStateVarName: string,
  stateNames: Set<string>
): {
  mooreOutputsByState: Map<string, FSMOutput[]>;
  mealyOutputsByTransition: Map<string, FSMOutput[]>; // key: "FROM->TO"
  outputSignals: string[];
  inputSignals: string[];
} {
  const mooreOutputsByState = new Map<string, FSMOutput[]>();
  const mealyOutputsByTransition = new Map<string, FSMOutput[]>();
  const outputSignals = new Set<string>();
  const inputSignals = new Set<string>();

  // Find case items
  const caseItems = findNodesOfType(caseStmt, 'case_item');

  for (const itemNode of caseItems) {
    const itemText = getNodeText(itemNode);
    const state = extractStateName(itemText, stateNames);

    if (!state) continue;

    // Parse the case item
    const item = parseCaseItemForOutputs(itemNode, itemText, stateVarName, nextStateVarName);

    // Extract Moore outputs (unconditional assignments)
    const mooreOutputs: FSMOutput[] = [];
    for (const assign of item.directAssignments) {
      if (!isStateVar(assign.target, stateVarName, nextStateVarName)) {
        mooreOutputs.push({
          signal: assign.target,
          value: assign.value,
          line: assign.line,
        });
        outputSignals.add(assign.target);
      }
    }
    if (mooreOutputs.length > 0) {
      mooreOutputsByState.set(state, mooreOutputs);
    }

    // Extract Mealy outputs (conditional assignments with transitions)
    for (const cond of item.conditionalBlocks) {
      const { outputs, transitionKey, inputs } = extractMealyFromConditional(
        cond,
        state,
        stateVarName,
        nextStateVarName,
        stateNames
      );

      if (transitionKey && outputs.length > 0) {
        mealyOutputsByTransition.set(transitionKey, outputs);
        for (const o of outputs) {
          outputSignals.add(o.signal);
        }
      }

      for (const input of inputs) {
        inputSignals.add(input);
      }
    }
  }

  return {
    mooreOutputsByState,
    mealyOutputsByTransition,
    outputSignals: Array.from(outputSignals),
    inputSignals: Array.from(inputSignals),
  };
}

/**
 * Parse a case item for output extraction.
 */
function parseCaseItemForOutputs(
  itemNode: SyntaxNode,
  itemText: string,
  stateVarName: string,
  nextStateVarName: string
): {
  directAssignments: Assignment[];
  conditionalBlocks: ConditionalBlock[];
} {
  const directAssignments: Assignment[] = [];
  const conditionalBlocks: ConditionalBlock[] = [];
  const line = getNodeLine(itemNode);

  // Extract content after the colon
  const colonIndex = itemText.indexOf(':');
  if (colonIndex < 0) {
    return { directAssignments, conditionalBlocks };
  }

  const content = itemText.substring(colonIndex + 1);

  // Check for begin/end block
  const beginMatch = content.match(/begin([\s\S]*?)end/i);
  const blockContent = beginMatch ? beginMatch[1] : content;

  // Find if statements
  const ifMatches = blockContent.matchAll(/if\s*\(([^)]+)\)\s*(?:begin\s*)?([\s\S]*?)(?:end|(?=\s*else|\s*$))/gi);

  let processedRanges: Array<[number, number]> = [];

  for (const match of ifMatches) {
    const condition = match[1].trim();
    const body = match[2];
    const startIndex = match.index!;
    const endIndex = startIndex + match[0].length;
    processedRanges.push([startIndex, endIndex]);

    const assignments = parseAssignments(body, line);

    conditionalBlocks.push({
      condition,
      assignments,
      line,
    });
  }

  // Extract direct assignments (not in if blocks)
  const directContent = removeRanges(blockContent, processedRanges);
  directAssignments.push(...parseAssignments(directContent, line));

  return { directAssignments, conditionalBlocks };
}

/**
 * Parse assignments from text.
 */
function parseAssignments(text: string, baseLine: number): Assignment[] {
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
 * Remove ranges from text.
 */
function removeRanges(text: string, ranges: Array<[number, number]>): string {
  let result = text;
  // Sort ranges in reverse order to maintain indices
  ranges.sort((a, b) => b[0] - a[0]);
  for (const [start, end] of ranges) {
    result = result.substring(0, start) + result.substring(end);
  }
  return result;
}

/**
 * Extract state name from case item text.
 */
function extractStateName(itemText: string, stateNames: Set<string>): string | null {
  const colonIndex = itemText.indexOf(':');
  if (colonIndex < 0) return null;

  const label = itemText.substring(0, colonIndex).trim();

  // Check if it's a known state
  if (stateNames.has(label)) {
    return label;
  }

  // Try to find a state name in the label
  for (const state of stateNames) {
    if (label.includes(state)) {
      return state;
    }
  }

  return null;
}

/**
 * Check if a variable is a state variable.
 */
function isStateVar(name: string, stateVarName: string, nextStateVarName: string): boolean {
  return name === stateVarName || name === nextStateVarName;
}

/**
 * Extract Mealy outputs from a conditional block.
 */
function extractMealyFromConditional(
  cond: ConditionalBlock,
  fromState: string,
  stateVarName: string,
  nextStateVarName: string,
  stateNames: Set<string>
): {
  outputs: FSMOutput[];
  transitionKey: string | null;
  inputs: string[];
} {
  const outputs: FSMOutput[] = [];
  let transitionKey: string | null = null;
  const inputs: string[] = [];

  // Extract input signals from condition
  const condVars = cond.condition.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g);
  if (condVars) {
    for (const v of condVars) {
      if (!['and', 'or', 'not'].includes(v.toLowerCase())) {
        inputs.push(v);
      }
    }
  }

  // Find state transition in this block
  for (const assign of cond.assignments) {
    if (isStateVar(assign.target, stateVarName, nextStateVarName)) {
      // This is a state transition
      const toState = assign.value;
      if (stateNames.has(toState)) {
        transitionKey = `${fromState}->${toState}`;
      }
    } else {
      // This is an output
      outputs.push({
        signal: assign.target,
        value: assign.value,
        line: assign.line,
      });
    }
  }

  return { outputs, transitionKey, inputs };
}

/**
 * Attach extracted outputs to transitions.
 */
export function attachOutputsToTransitions(
  transitions: FSMTransition[],
  mealyOutputsByTransition: Map<string, FSMOutput[]>
): void {
  for (const transition of transitions) {
    const key = `${transition.from}->${transition.to}`;
    const outputs = mealyOutputsByTransition.get(key);
    if (outputs) {
      transition.outputs = outputs;
    }
  }
}

/**
 * Format output for display.
 */
export function formatOutput(output: FSMOutput): string {
  // Simplify common value patterns
  let value = output.value;

  // 1'b1 → 1, 1'b0 → 0
  value = value.replace(/1'b1/g, '1').replace(/1'b0/g, '0');

  return `${output.signal}=${value}`;
}

/**
 * Format multiple outputs for display.
 */
export function formatOutputs(outputs: FSMOutput[]): string {
  return outputs.map(formatOutput).join(', ');
}
