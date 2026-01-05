import type { SyntaxNode } from '../parser/ast-walker.js';
import {
  walkTree,
  findNodesOfType,
  getNodeText,
  getNodeLine,
  getChildOfType,
  findFirstNodeOfType,
} from '../parser/ast-walker.js';
import { isResetSignalName } from '../parser/queries.js';
import type { AlwaysBlock, StateRegister } from '../types.js';

/**
 * Analyze always blocks in the AST.
 *
 * Identifies:
 * - Block type (always_ff, always_comb, always @(*))
 * - Reset logic
 * - State variable assignments
 */
export function analyzeAlwaysBlocks(
  root: SyntaxNode,
  stateRegisters: StateRegister[]
): AlwaysBlock[] {
  const results: AlwaysBlock[] = [];
  const stateVarNames = new Set(stateRegisters.map((r) => r.varName));

  // Find all always_construct nodes
  const alwaysNodes = findNodesOfType(root, 'always_construct');

  for (const alwaysNode of alwaysNodes) {
    const block = analyzeAlwaysBlock(alwaysNode, stateVarNames);
    if (block) {
      results.push(block);
    }
  }

  return results;
}

/**
 * Analyze a single always block.
 */
function analyzeAlwaysBlock(
  alwaysNode: SyntaxNode,
  stateVarNames: Set<string>
): AlwaysBlock | null {
  const text = getNodeText(alwaysNode);
  const line = getNodeLine(alwaysNode);

  // Determine block type from the always keyword
  const blockType = detectBlockType(alwaysNode, text);

  // Extract sensitivity list for always @(...) blocks
  const sensitivityList = extractSensitivityList(alwaysNode, text);

  // Detect reset logic
  const resetInfo = detectResetLogic(alwaysNode, text);

  // Find state assignments
  const stateAssignments = findStateAssignments(alwaysNode, stateVarNames);

  return {
    type: blockType,
    line,
    sensitivityList,
    hasReset: resetInfo.hasReset,
    resetSignal: resetInfo.resetSignal,
    resetPolarity: resetInfo.resetPolarity,
    stateAssignments,
  };
}

/**
 * Detect the type of always block.
 *
 * Note: always_construct does NOT distinguish always_ff vs always_comb as separate
 * node types. We must look at the always_keyword child to determine the type.
 */
function detectBlockType(
  alwaysNode: SyntaxNode,
  text: string
): 'always_ff' | 'always_comb' | 'always' {
  // Look for always_keyword child
  let keywordText = '';
  walkTree(alwaysNode, (node) => {
    if (node.type === 'always_keyword' || node.type === 'always_ff' || node.type === 'always_comb') {
      keywordText = getNodeText(node).trim();
      return true; // Stop searching
    }
  });

  // Check keyword text
  if (keywordText === 'always_ff' || text.startsWith('always_ff')) {
    return 'always_ff';
  }
  if (keywordText === 'always_comb' || text.startsWith('always_comb')) {
    return 'always_comb';
  }

  // Legacy always @(...) block
  return 'always';
}

/**
 * Extract sensitivity list from always @(...) blocks.
 */
function extractSensitivityList(alwaysNode: SyntaxNode, text: string): string[] | undefined {
  // Look for event_expression or sensitivity_list nodes
  const signals: string[] = [];

  walkTree(alwaysNode, (node) => {
    if (node.type === 'event_expression' || node.type === 'edge_identifier') {
      const eventText = getNodeText(node);
      // Extract signal names from posedge/negedge expressions
      const edgeMatch = eventText.match(/(posedge|negedge)\s+(\w+)/i);
      if (edgeMatch) {
        signals.push(`${edgeMatch[1]} ${edgeMatch[2]}`);
      } else {
        // Plain signal
        const plainMatch = eventText.match(/\b([a-zA-Z_]\w*)\b/);
        if (plainMatch && !['or', 'and', 'posedge', 'negedge'].includes(plainMatch[1].toLowerCase())) {
          signals.push(plainMatch[1]);
        }
      }
    }
  });

  // Fallback: extract from text using regex
  if (signals.length === 0) {
    const match = text.match(/@\s*\(([^)]+)\)/);
    if (match) {
      const content = match[1];
      // Parse posedge/negedge signals
      const edgeMatches = content.matchAll(/(posedge|negedge)\s+(\w+)/gi);
      for (const m of edgeMatches) {
        signals.push(`${m[1]} ${m[2]}`);
      }
      // Parse plain signals (if @(*) or @(a, b))
      if (content.includes('*')) {
        signals.push('*');
      }
    }
  }

  return signals.length > 0 ? signals : undefined;
}

/**
 * Detect reset logic in an always block.
 */
function detectResetLogic(
  alwaysNode: SyntaxNode,
  text: string
): { hasReset: boolean; resetSignal?: string; resetPolarity?: 'active_high' | 'active_low' } {
  // Check sensitivity list for async reset
  const sensMatch = text.match(/(posedge|negedge)\s+(\w+)/gi);
  const asyncResetCandidates: Array<{ signal: string; edge: string }> = [];

  if (sensMatch) {
    for (const m of sensMatch) {
      const match = m.match(/(posedge|negedge)\s+(\w+)/i);
      if (match) {
        const edge = match[1].toLowerCase();
        const signal = match[2];
        // Skip clock signals
        if (!/^(clk|clock|ck)$/i.test(signal)) {
          asyncResetCandidates.push({ signal, edge });
        }
      }
    }
  }

  // Look for reset conditions in the block
  const resetConditions = findResetConditions(alwaysNode, text);

  // Combine async and sync reset detection
  for (const candidate of asyncResetCandidates) {
    if (isResetSignalName(candidate.signal)) {
      return {
        hasReset: true,
        resetSignal: candidate.signal,
        resetPolarity: candidate.edge === 'negedge' ? 'active_low' : 'active_high',
      };
    }
  }

  // Check sync reset conditions
  for (const cond of resetConditions) {
    if (cond.signal && isResetSignalName(cond.signal)) {
      return {
        hasReset: true,
        resetSignal: cond.signal,
        resetPolarity: cond.isNegated ? 'active_low' : 'active_high',
      };
    }
  }

  return { hasReset: false };
}

/**
 * Find reset-related conditions in the always block.
 */
function findResetConditions(
  alwaysNode: SyntaxNode,
  text: string
): Array<{ signal?: string; isNegated: boolean }> {
  const conditions: Array<{ signal?: string; isNegated: boolean }> = [];

  // Look for if statements at the top of the always block
  // Pattern: if (!rst_n) or if (rst)
  const ifPatterns = [
    /if\s*\(\s*!\s*(\w+)\s*\)/g,        // if (!rst_n)
    /if\s*\(\s*~\s*(\w+)\s*\)/g,        // if (~rst_n)
    /if\s*\(\s*(\w+)\s*==\s*1'b0\s*\)/g, // if (rst == 1'b0)
    /if\s*\(\s*(\w+)\s*===\s*1'b0\s*\)/g, // if (rst === 1'b0)
    /if\s*\(\s*(\w+)\s*\)/g,            // if (rst)
    /if\s*\(\s*(\w+)\s*==\s*1'b1\s*\)/g, // if (rst == 1'b1)
  ];

  for (let i = 0; i < ifPatterns.length; i++) {
    const pattern = ifPatterns[i];
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const signal = match[1];
      const isNegated = i < 4; // First 4 patterns are negated
      conditions.push({ signal, isNegated });
    }
  }

  return conditions;
}

/**
 * Find state variable assignments in the always block.
 */
function findStateAssignments(
  alwaysNode: SyntaxNode,
  stateVarNames: Set<string>
): string[] {
  const assignments: string[] = [];

  walkTree(alwaysNode, (node) => {
    // Check for blocking and non-blocking assignments
    if (
      node.type === 'blocking_assignment' ||
      node.type === 'nonblocking_assignment'
    ) {
      const text = getNodeText(node);
      // Extract target variable
      const match = text.match(/^\s*(\w+)\s*<?=/);
      if (match) {
        const target = match[1];
        if (stateVarNames.has(target)) {
          if (!assignments.includes(target)) {
            assignments.push(target);
          }
        }
      }
    }
  });

  return assignments;
}

/**
 * Find case statements on state variables in an always block.
 */
export function findStateCaseStatements(
  alwaysNode: SyntaxNode,
  stateVarNames: Set<string>
): SyntaxNode[] {
  const caseStatements: SyntaxNode[] = [];

  const allCases = findNodesOfType(alwaysNode, 'case_statement');

  for (const caseStmt of allCases) {
    const caseExpr = getCaseExpression(caseStmt);
    if (caseExpr && stateVarNames.has(caseExpr)) {
      caseStatements.push(caseStmt);
    }
  }

  return caseStatements;
}

/**
 * Get the expression being switched on in a case statement.
 */
export function getCaseExpression(caseStmt: SyntaxNode): string | null {
  const text = getNodeText(caseStmt);

  // Extract case expression: case (expr) or casez (expr)
  const match = text.match(/case[zx]?\s*\(\s*(\w+)\s*\)/i);
  if (match) {
    return match[1];
  }

  // Try to find via AST
  walkTree(caseStmt, (node) => {
    if (node.type === 'case_expression' || node.type === 'expression') {
      // This might be the case expression
      const parent = node.parent;
      if (parent === caseStmt || parent?.type === 'case_statement') {
        return true;
      }
    }
  });

  return null;
}

/**
 * Determine FSM block style from always blocks.
 */
export function detectBlockStyle(
  alwaysBlocks: AlwaysBlock[],
  stateVarName: string,
  nextStateVarName?: string
): 'one-block' | 'two-block' | 'three-block' {
  // Find blocks that assign to state variables
  const stateAssigners = alwaysBlocks.filter((b) =>
    b.stateAssignments.includes(stateVarName)
  );
  const nextStateAssigners = nextStateVarName
    ? alwaysBlocks.filter((b) => b.stateAssignments.includes(nextStateVarName))
    : [];

  // One-block: single always_ff that assigns directly to state
  if (stateAssigners.length === 1 && nextStateAssigners.length === 0) {
    const block = stateAssigners[0];
    if (block.type === 'always_ff' || block.type === 'always') {
      return 'one-block';
    }
  }

  // Two-block: always_ff assigns state <= next_state, always_comb computes next_state
  if (nextStateVarName) {
    const ffBlocks = stateAssigners.filter((b) => b.type === 'always_ff' || b.type === 'always');
    const combBlocks = nextStateAssigners.filter((b) => b.type === 'always_comb' || b.type === 'always');

    if (ffBlocks.length >= 1 && combBlocks.length >= 1) {
      // Check for three-block: separate output logic
      // (Hard to detect without more analysis, default to two-block)
      return 'two-block';
    }
  }

  // Fallback
  return stateAssigners.length === 1 ? 'one-block' : 'two-block';
}

/**
 * Get the always block containing state transition logic.
 */
export function getTransitionBlock(
  alwaysBlocks: AlwaysBlock[],
  stateVarName: string,
  nextStateVarName?: string
): AlwaysBlock | null {
  // For two-block FSM, look for the always_comb that assigns next_state
  if (nextStateVarName) {
    const combBlock = alwaysBlocks.find(
      (b) =>
        (b.type === 'always_comb' || b.type === 'always') &&
        b.stateAssignments.includes(nextStateVarName)
    );
    if (combBlock) {
      return combBlock;
    }
  }

  // For one-block FSM, use the always_ff that assigns state
  const ffBlock = alwaysBlocks.find(
    (b) =>
      (b.type === 'always_ff' || b.type === 'always') &&
      b.stateAssignments.includes(stateVarName)
  );

  return ffBlock || null;
}
