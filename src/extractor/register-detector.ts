import type { SyntaxNode } from '../parser/ast-walker.js';
import {
  walkTree,
  findNodesOfType,
  getNodeText,
  getNodeLine,
} from '../parser/ast-walker.js';
import {
  isStateVarName,
  isNextStateVarName,
  isExcludedStateVar,
} from '../parser/queries.js';
import type { StateRegister, EnumDefinition } from '../types.js';

/**
 * Detect state register variables in the AST.
 *
 * Patterns we handle:
 * - state_t state, next_state;
 * - state_t current_state;
 * - logic [1:0] state, ns;
 */
export function detectStateRegisters(
  root: SyntaxNode,
  enumDefs: EnumDefinition[]
): StateRegister[] {
  const results: StateRegister[] = [];
  const enumTypeNames = new Set(enumDefs.map((e) => e.typeName));

  // Find all variable declarations
  const dataDecls = findNodesOfType(root, 'data_declaration');

  for (const dataDecl of dataDecls) {
    const registers = extractStateRegistersFromDecl(dataDecl, enumTypeNames);
    results.push(...registers);
  }

  // Also look for net declarations (wire/reg)
  const netDecls = findNodesOfType(root, 'net_declaration');
  for (const netDecl of netDecls) {
    const registers = extractStateRegistersFromDecl(netDecl, enumTypeNames);
    results.push(...registers);
  }

  return results;
}

/**
 * Extract state registers from a declaration node.
 */
function extractStateRegistersFromDecl(
  declNode: SyntaxNode,
  enumTypeNames: Set<string>
): StateRegister[] {
  const results: StateRegister[] = [];
  const text = getNodeText(declNode);
  const line = getNodeLine(declNode);

  // Check if this declaration uses an enum type
  let typeName: string | undefined;
  for (const enumType of enumTypeNames) {
    if (text.includes(enumType)) {
      typeName = enumType;
      break;
    }
  }

  // Extract variable names from the declaration
  const varNames = extractVariableNames(declNode, text);

  for (const varName of varNames) {
    // Skip excluded patterns
    if (isExcludedStateVar(varName)) {
      continue;
    }

    // Check if this looks like a state variable
    const isState = typeName !== undefined || isStateVarName(varName);

    if (isState) {
      results.push({
        varName,
        typeName,
        isNextState: isNextStateVarName(varName),
        line,
      });
    }
  }

  return results;
}

/**
 * Extract variable names from a declaration.
 */
function extractVariableNames(declNode: SyntaxNode, text: string): string[] {
  const names: string[] = [];

  // Try to find variable_decl_assignment nodes
  walkTree(declNode, (node) => {
    if (node.type === 'variable_decl_assignment') {
      // Get the identifier from this assignment
      const identNode = node.children.find(
        (c) => c.type === 'simple_identifier' || c.type === 'identifier'
      );
      if (identNode) {
        names.push(getNodeText(identNode).trim());
      }
    }
  });

  // Fallback: extract from text using regex
  if (names.length === 0) {
    // Match: type name1, name2, name3;
    // But skip the type name
    const match = text.match(/(\w+)\s+([^;]+);/);
    if (match) {
      const varPart = match[2];
      const varMatches = varPart.match(/\b([a-zA-Z_]\w*)\b/g);
      if (varMatches) {
        // Filter out common type keywords
        const typeKeywords = new Set(['logic', 'reg', 'wire', 'input', 'output', 'inout']);
        for (const v of varMatches) {
          if (!typeKeywords.has(v.toLowerCase())) {
            names.push(v);
          }
        }
      }
    }
  }

  return names;
}

/**
 * Match state registers to form state/next_state pairs.
 */
export function matchStateRegisterPairs(
  registers: StateRegister[]
): Array<{ state: StateRegister; nextState?: StateRegister }> {
  const pairs: Array<{ state: StateRegister; nextState?: StateRegister }> = [];
  const used = new Set<StateRegister>();

  // Group registers by type
  const byType = new Map<string | undefined, StateRegister[]>();
  for (const reg of registers) {
    const key = reg.typeName;
    if (!byType.has(key)) {
      byType.set(key, []);
    }
    byType.get(key)!.push(reg);
  }

  // For each type group, try to pair state with next_state
  for (const [_typeName, regs] of byType) {
    const stateRegs = regs.filter((r) => !r.isNextState);
    const nextStateRegs = regs.filter((r) => r.isNextState);

    for (const stateReg of stateRegs) {
      // Try to find matching next_state
      let matchedNext: StateRegister | undefined;

      for (const nextReg of nextStateRegs) {
        if (used.has(nextReg)) continue;

        // Check if names suggest a pair
        if (areMatchingStateNames(stateReg.varName, nextReg.varName)) {
          matchedNext = nextReg;
          break;
        }
      }

      // If no match found by name, use first available next_state of same type
      if (!matchedNext && nextStateRegs.length > 0) {
        matchedNext = nextStateRegs.find((r) => !used.has(r));
      }

      if (matchedNext) {
        used.add(matchedNext);
      }
      used.add(stateReg);

      pairs.push({
        state: stateReg,
        nextState: matchedNext,
      });
    }

    // Handle any orphaned next_state registers (could be one-block FSM)
    for (const nextReg of nextStateRegs) {
      if (!used.has(nextReg)) {
        pairs.push({
          state: nextReg, // Treat as state for one-block FSM
        });
        used.add(nextReg);
      }
    }
  }

  return pairs;
}

/**
 * Check if two variable names suggest a state/next_state pair.
 */
function areMatchingStateNames(stateName: string, nextStateName: string): boolean {
  const state = stateName.toLowerCase();
  const next = nextStateName.toLowerCase();

  // Common patterns
  const patterns = [
    // state -> next_state
    { state: /^(.*)state$/, next: /^(.*)next_state$/ },
    // cs -> ns
    { state: /^(.*)cs$/, next: /^(.*)ns$/ },
    // cstate -> nstate
    { state: /^(.*)cstate$/, next: /^(.*)nstate$/ },
    // state_q -> state_d
    { state: /^(.*)_q$/, next: /^(.*)_d$/ },
    // state -> state_next
    { state: /^(.*)state$/, next: /^(.*)state_next$/ },
  ];

  for (const pattern of patterns) {
    const stateMatch = state.match(pattern.state);
    const nextMatch = next.match(pattern.next);
    if (stateMatch && nextMatch) {
      // Check prefixes match
      if (stateMatch[1] === nextMatch[1]) {
        return true;
      }
    }
  }

  // Direct naming patterns
  if (state === 'state' && next === 'next_state') return true;
  if (state === 'cs' && next === 'ns') return true;
  if (state === 'current_state' && next === 'next_state') return true;
  if (state === 'ps' && next === 'ns') return true;

  return false;
}

/**
 * Find the best state register pair for a given enum type.
 */
export function findStateRegistersForEnum(
  enumDef: EnumDefinition,
  pairs: Array<{ state: StateRegister; nextState?: StateRegister }>
): { state: StateRegister; nextState?: StateRegister } | null {
  // First try to find exact type match
  for (const pair of pairs) {
    if (pair.state.typeName === enumDef.typeName) {
      return pair;
    }
  }

  // No match found
  return null;
}
