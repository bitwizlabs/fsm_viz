import type { SyntaxNode } from '../parser/ast-walker.js';
import {
  walkTree,
  findNodesOfType,
  getNodeText,
  getNodeLine,
  getChildOfType,
  getChildrenOfType,
} from '../parser/ast-walker.js';
import type { EnumDefinition } from '../types.js';

/**
 * Detect typedef enum state definitions in the AST.
 *
 * Patterns we handle:
 * - typedef enum logic [1:0] { IDLE, RUN, DONE } state_t;
 * - typedef enum logic [1:0] { IDLE=2'b00, RUN=2'b01 } state_t;
 * - typedef enum { IDLE, RUN, DONE } state_t;
 * - enum { IDLE, RUN, DONE } state; (direct, no typedef)
 */
export function detectEnumDefinitions(root: SyntaxNode): EnumDefinition[] {
  const results: EnumDefinition[] = [];

  // Look for type declarations (typedef)
  const typeDecls = findNodesOfType(root, 'type_declaration');
  for (const typeDecl of typeDecls) {
    const enumDef = extractTypedefEnum(typeDecl);
    if (enumDef) {
      results.push(enumDef);
    }
  }

  // Also look for direct enum declarations without typedef
  // These appear as data_declaration with enum inside
  const dataDecls = findNodesOfType(root, 'data_declaration');
  for (const dataDecl of dataDecls) {
    const enumDef = extractDirectEnum(dataDecl);
    if (enumDef) {
      results.push(enumDef);
    }
  }

  return results;
}

/**
 * Extract enum definition from a typedef declaration.
 */
function extractTypedefEnum(typeDecl: SyntaxNode): EnumDefinition | null {
  const text = getNodeText(typeDecl);

  // Quick check: must contain 'enum'
  if (!text.includes('enum')) {
    return null;
  }

  // Find the enum type identifier (the typedef name, e.g., state_t)
  let typeName = '';
  let enumStates: Array<{ name: string; encoding?: string; line: number }> = [];

  walkTree(typeDecl, (node) => {
    // Look for the type identifier (last identifier is usually the typedef name)
    if (node.type === 'simple_identifier' || node.type === 'type_identifier') {
      // Check if this identifier is in an enum value position or the type name
      const parent = node.parent;
      if (parent && parent.type === 'type_declaration') {
        // This is likely the typedef name
        typeName = getNodeText(node);
      }
    }

    // Look for enum name declarations (the state names)
    if (node.type === 'enum_name_declaration') {
      const state = extractEnumState(node);
      if (state) {
        enumStates.push(state);
      }
    }
  });

  // Fallback: try to extract typedef name from text using regex
  if (!typeName) {
    const match = text.match(/}\s*(\w+)\s*;/);
    if (match) {
      typeName = match[1];
    }
  }

  // Also try to find states in the raw text if AST didn't find them
  if (enumStates.length === 0) {
    enumStates = extractEnumStatesFromText(text, getNodeLine(typeDecl));
  }

  if (!typeName || enumStates.length === 0) {
    return null;
  }

  return {
    typeName,
    states: enumStates,
    line: getNodeLine(typeDecl),
  };
}

/**
 * Extract enum definition from a direct enum declaration (not typedef).
 */
function extractDirectEnum(dataDecl: SyntaxNode): EnumDefinition | null {
  const text = getNodeText(dataDecl);

  // Quick check: must contain 'enum' but not 'typedef'
  if (!text.includes('enum') || text.includes('typedef')) {
    return null;
  }

  let varName = '';
  let enumStates: Array<{ name: string; encoding?: string; line: number }> = [];

  walkTree(dataDecl, (node) => {
    // Look for the variable name
    if (node.type === 'variable_decl_assignment' || node.type === 'simple_identifier') {
      const parent = node.parent;
      // Find the actual variable identifier
      if (parent && (parent.type === 'variable_decl_assignment' || parent.type === 'list_of_variable_decl_assignments')) {
        varName = getNodeText(node).trim();
      }
    }

    // Look for enum name declarations
    if (node.type === 'enum_name_declaration') {
      const state = extractEnumState(node);
      if (state) {
        enumStates.push(state);
      }
    }
  });

  // Fallback: extract from text
  if (!varName) {
    const match = text.match(/}\s*(\w+)\s*[,;]/);
    if (match) {
      varName = match[1];
    }
  }

  if (enumStates.length === 0) {
    enumStates = extractEnumStatesFromText(text, getNodeLine(dataDecl));
  }

  if (!varName || enumStates.length === 0) {
    return null;
  }

  return {
    typeName: varName, // For direct enums, use variable name as the "type"
    states: enumStates,
    line: getNodeLine(dataDecl),
  };
}

/**
 * Extract a single enum state from an enum_name_declaration node.
 */
function extractEnumState(node: SyntaxNode): { name: string; encoding?: string; line: number } | null {
  const text = getNodeText(node).trim();
  const line = getNodeLine(node);

  // Check for encoding: STATE = value
  const match = text.match(/^(\w+)\s*=\s*(.+)$/);
  if (match) {
    return {
      name: match[1],
      encoding: match[2].trim(),
      line,
    };
  }

  // Simple state name
  const nameMatch = text.match(/^(\w+)$/);
  if (nameMatch) {
    return {
      name: nameMatch[1],
      line,
    };
  }

  return null;
}

/**
 * Fallback: extract enum states from text using regex.
 */
function extractEnumStatesFromText(
  text: string,
  baseLine: number
): Array<{ name: string; encoding?: string; line: number }> {
  const results: Array<{ name: string; encoding?: string; line: number }> = [];

  // Match content between { and }
  const enumMatch = text.match(/\{([^}]+)\}/);
  if (!enumMatch) {
    return results;
  }

  const enumContent = enumMatch[1];
  const items = enumContent.split(',');

  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;

    // Check for encoding: STATE = value
    const encodingMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (encodingMatch) {
      results.push({
        name: encodingMatch[1],
        encoding: encodingMatch[2].trim(),
        line: baseLine,
      });
    } else {
      // Simple state name
      const nameMatch = trimmed.match(/^(\w+)$/);
      if (nameMatch) {
        results.push({
          name: nameMatch[1],
          line: baseLine,
        });
      }
    }
  }

  return results;
}

/**
 * Check if an enum definition looks like FSM states.
 *
 * Heuristics:
 * - Type name contains "state", "fsm", etc.
 * - State names look like FSM states (IDLE, RUN, DONE, etc.)
 */
export function looksLikeFSMEnum(enumDef: EnumDefinition): boolean {
  const typeName = enumDef.typeName.toLowerCase();

  // Check type name
  if (
    typeName.includes('state') ||
    typeName.includes('fsm') ||
    typeName.includes('phase') ||
    typeName.includes('mode')
  ) {
    return true;
  }

  // Check state names for common FSM patterns
  const stateNames = enumDef.states.map((s) => s.name.toLowerCase());
  const fsmStatePatterns = ['idle', 'init', 'start', 'run', 'done', 'wait', 'ready', 'busy', 'error'];

  const matchCount = stateNames.filter((name) =>
    fsmStatePatterns.some((pattern) => name.includes(pattern))
  ).length;

  // If at least 2 states match common patterns, likely an FSM
  return matchCount >= 2;
}

/**
 * Detect encoding type from enum values.
 */
export function detectEncodingType(
  enumDef: EnumDefinition
): 'binary' | 'onehot' | 'gray' | 'unknown' {
  const encodings = enumDef.states
    .map((s) => s.encoding)
    .filter((e): e is string => !!e);

  if (encodings.length === 0) {
    return 'unknown'; // No explicit encoding
  }

  // Parse encodings to numbers
  const values = encodings.map((e) => parseVerilogNumber(e)).filter((v) => v !== null) as number[];

  if (values.length !== encodings.length) {
    return 'unknown'; // Couldn't parse all encodings
  }

  // Check for one-hot (each value has exactly one bit set)
  const isOneHot = values.every((v) => v > 0 && (v & (v - 1)) === 0);
  if (isOneHot && values.length > 1) {
    return 'onehot';
  }

  // Check for gray code (adjacent values differ by one bit)
  const sortedValues = [...values].sort((a, b) => a - b);
  let isGray = true;
  for (let i = 1; i < sortedValues.length; i++) {
    const diff = sortedValues[i] ^ sortedValues[i - 1];
    if ((diff & (diff - 1)) !== 0) {
      isGray = false;
      break;
    }
  }
  if (isGray && sortedValues.length > 1) {
    return 'gray';
  }

  return 'binary';
}

/**
 * Parse Verilog number format to integer.
 */
function parseVerilogNumber(str: string): number | null {
  // Remove whitespace
  const s = str.trim();

  // Binary: 2'b00, 4'b0010
  const binMatch = s.match(/\d*'b([01_]+)/i);
  if (binMatch) {
    return parseInt(binMatch[1].replace(/_/g, ''), 2);
  }

  // Hex: 4'h0, 8'hFF
  const hexMatch = s.match(/\d*'h([0-9a-f_]+)/i);
  if (hexMatch) {
    return parseInt(hexMatch[1].replace(/_/g, ''), 16);
  }

  // Decimal: 3'd5, 'd10
  const decMatch = s.match(/\d*'d?(\d+)/i);
  if (decMatch) {
    return parseInt(decMatch[1], 10);
  }

  // Plain integer
  if (/^\d+$/.test(s)) {
    return parseInt(s, 10);
  }

  return null;
}
