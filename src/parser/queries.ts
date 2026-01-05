/**
 * Tree-sitter query patterns for SystemVerilog FSM extraction.
 *
 * Note: Node type names are based on tree-sitter-systemverilog grammar.
 * These may need adjustment based on actual AST exploration.
 *
 * Known node types from tree-sitter-systemverilog:
 * - type_declaration (NOT enum_declaration)
 * - always_construct (NOT always_block) - covers always_ff, always_comb, always @(*)
 * - case_statement
 * - enum_name_declaration (for individual enum members)
 */

// Node types we're looking for
export const NODE_TYPES = {
  // Module structure
  MODULE: 'module_declaration',
  MODULE_HEADER: 'module_header',
  MODULE_IDENTIFIER: 'module_identifier',

  // Type definitions
  TYPE_DECLARATION: 'type_declaration',
  DATA_TYPE: 'data_type',
  ENUM_TYPE: 'enum_name_declaration',

  // Variables
  DATA_DECLARATION: 'data_declaration',
  VARIABLE_DECL: 'variable_decl_assignment',

  // Always blocks
  ALWAYS_CONSTRUCT: 'always_construct',
  ALWAYS_KEYWORD: 'always_keyword',

  // Statements
  CASE_STATEMENT: 'case_statement',
  CASE_ITEM: 'case_item',
  CASE_EXPRESSION: 'case_item_expression',
  IF_STATEMENT: 'conditional_statement',
  BLOCKING_ASSIGNMENT: 'blocking_assignment',
  NONBLOCKING_ASSIGNMENT: 'nonblocking_assignment',

  // Expressions
  IDENTIFIER: 'simple_identifier',
  EXPRESSION: 'expression',
  BINARY_EXPRESSION: 'binary_expression',
  UNARY_EXPRESSION: 'unary_expression',

  // Comments
  COMMENT: 'comment',
} as const;

// Patterns for identifying state-related variable names
export const STATE_VAR_PATTERNS = [
  /^state$/i,
  /^current_state$/i,
  /^next_state$/i,
  /^cs$/i,
  /^ns$/i,
  /^ps$/i,         // present state
  /^cstate$/i,
  /^nstate$/i,
  /^fsm_state$/i,
  /^fsm_cs$/i,
  /^fsm_ns$/i,
  /state_r$/i,     // state register
  /state_q$/i,     // state flop output
  /state_d$/i,     // state flop input (next state)
];

// Patterns for identifying next-state variable names
export const NEXT_STATE_PATTERNS = [
  /^next_state$/i,
  /^ns$/i,
  /^nstate$/i,
  /^fsm_ns$/i,
  /state_d$/i,
  /state_next$/i,
  /_next$/i,
  /_n$/i,
];

// Patterns for reset signal names
export const RESET_SIGNAL_PATTERNS = [
  /^rst$/i,
  /^rst_n$/i,
  /^reset$/i,
  /^reset_n$/i,
  /^arst$/i,       // async reset
  /^arst_n$/i,
  /^srst$/i,       // sync reset
  /^nrst$/i,
];

// Keywords that indicate always block type
export const ALWAYS_KEYWORDS = {
  ALWAYS_FF: 'always_ff',
  ALWAYS_COMB: 'always_comb',
  ALWAYS_LATCH: 'always_latch',
  ALWAYS: 'always',
} as const;

// Check if a variable name looks like a state variable
export function isStateVarName(name: string): boolean {
  return STATE_VAR_PATTERNS.some((pattern) => pattern.test(name));
}

// Check if a variable name looks like a next-state variable
export function isNextStateVarName(name: string): boolean {
  return NEXT_STATE_PATTERNS.some((pattern) => pattern.test(name));
}

// Check if a signal name looks like a reset signal
export function isResetSignalName(name: string): boolean {
  return RESET_SIGNAL_PATTERNS.some((pattern) => pattern.test(name));
}

// Variables that should NOT be considered state variables
export const STATE_VAR_EXCLUSIONS = [
  /state_machine_enable/i,
  /state_counter/i,
  /state_valid/i,
  /state_error/i,
  /state_flag/i,
  /state_bits/i,
  /state_width/i,
  /num_states/i,
];

// Check if a variable name should be excluded as a state variable
export function isExcludedStateVar(name: string): boolean {
  return STATE_VAR_EXCLUSIONS.some((pattern) => pattern.test(name));
}
