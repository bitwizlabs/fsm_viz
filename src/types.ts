// Output signal assignment (Moore or Mealy)
export interface FSMOutput {
  signal: string;             // e.g., "enable"
  value: string;              // e.g., "1'b1"
  line: number;
}

export interface FSMState {
  name: string;
  encoding?: string;          // e.g., "2'b00"
  line: number;
  isDefault?: boolean;
  outputs: FSMOutput[];       // Moore outputs: depend only on state
  comment?: string;           // Extracted from nearby comments
  isUnreachable?: boolean;    // No incoming transitions (except reset)
  isTerminal?: boolean;       // No outgoing transitions
}

export interface FSMTransition {
  from: string;
  to: string;
  condition?: string;           // Simplified guard (e.g., "start")
  rawCondition?: string;        // Original code before simplification
  line: number;
  priority?: number;            // For priority case / overlapping conditions
  isDefault?: boolean;          // From default/wildcard case
  isSelfLoop?: boolean;         // Staying in same state
  isImplicit?: boolean;         // Inferred from default assignment
  sourceBlock: 'always_ff' | 'always_comb' | 'always';
  outputs: FSMOutput[];         // Mealy outputs: depend on state + inputs
}

export interface FSMWarning {
  type: 'unreachable_state' | 'terminal_state' | 'missing_case' |
        'no_reset' | 'implicit_default';
  message: string;
  line?: number;
  states?: string[];            // Affected states
}

export interface FSM {
  name: string;                 // Derived from state type name or variable
  states: FSMState[];
  transitions: FSMTransition[];
  resetState?: string;
  encoding: 'binary' | 'onehot' | 'gray' | 'unknown';
  stateVarName: string;         // e.g., "state"
  nextStateVarName?: string;    // e.g., "next_state" (if two-block)
  blockStyle: 'one-block' | 'two-block' | 'three-block';
  confidence: number;           // 0-1, with breakdown
  confidenceBreakdown: {
    stateDetection: number;
    transitionExtraction: number;
    resetDetection: number;
    outputExtraction: number;
  };
  warnings: FSMWarning[];
  errors: string[];             // Non-fatal parse issues
  inputSignals: string[];       // Signals that appear in conditions
  outputSignals: string[];      // Signals assigned in states/transitions
}

// What we can detect vs what we infer
export interface DetectionMetadata {
  statesExplicit: boolean;      // Found typedef enum vs inferred
  transitionsComplete: boolean; // All branches covered vs gaps
  hasImplicitSelfLoops: boolean;// Default assignment pattern detected
  hasMooreOutputs: boolean;     // Found state-dependent outputs
  hasMealyOutputs: boolean;     // Found transition-dependent outputs
}

// Support for multiple FSMs per module
export interface ModuleAnalysis {
  moduleName: string;
  fsms: FSM[];                  // Can have multiple FSMs
  parseErrors: string[];
}

// Mermaid output options
export interface MermaidOptions {
  direction: 'TB' | 'LR';
  showConditions: boolean;
  showOutputs: boolean;
  showSelfLoops: boolean;
}

// CLI options
export interface ExtractOptions {
  output?: string;
  format: 'mermaid' | 'json';
  direction: 'TB' | 'LR';
  conditions: boolean;
  outputs: boolean;
  warnings: boolean;
  module?: string;
  fsm?: string;
}

// Source location for click-to-source
export interface SourceLocation {
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

// Enum state definition found in source
export interface EnumDefinition {
  typeName: string;
  states: Array<{
    name: string;
    encoding?: string;
    line: number;
  }>;
  line: number;
}

// State register variable found in source
export interface StateRegister {
  varName: string;
  typeName?: string;
  isNextState: boolean;
  line: number;
}

// Always block information
export interface AlwaysBlock {
  type: 'always_ff' | 'always_comb' | 'always';
  line: number;
  sensitivityList?: string[];
  hasReset: boolean;
  resetSignal?: string;
  resetPolarity?: 'active_high' | 'active_low';
  stateAssignments: string[];   // State variables assigned in this block
}

// Case item in a case statement
export interface CaseItem {
  label: string;                // State name or 'default'
  line: number;
  assignments: Assignment[];
  conditions: ConditionalBlock[];
}

// Assignment statement
export interface Assignment {
  target: string;
  value: string;
  line: number;
  isBlocking: boolean;
}

// Conditional block (if/else)
export interface ConditionalBlock {
  condition: string;
  assignments: Assignment[];
  elseAssignments?: Assignment[];
  nestedConditions?: ConditionalBlock[];
  line: number;
}
