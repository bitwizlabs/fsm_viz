/**
 * User-friendly error messages for FSM extraction.
 */

export class FSMExtractionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly line?: number,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'FSMExtractionError';
  }

  toString(): string {
    let msg = this.message;
    if (this.line) {
      msg += ` (line ${this.line})`;
    }
    if (this.details) {
      msg += `\n  ${this.details}`;
    }
    return msg;
  }
}

export const ErrorCodes = {
  PARSE_ERROR: 'PARSE_ERROR',
  NO_MODULE: 'NO_MODULE',
  NO_FSM: 'NO_FSM',
  NO_STATES: 'NO_STATES',
  NO_TRANSITIONS: 'NO_TRANSITIONS',
  INVALID_INPUT: 'INVALID_INPUT',
  WASM_INIT: 'WASM_INIT',
  UNSUPPORTED_PATTERN: 'UNSUPPORTED_PATTERN',
} as const;

/**
 * Create a parse error.
 */
export function parseError(message: string, line?: number): FSMExtractionError {
  return new FSMExtractionError(
    `Parse error: ${message}`,
    ErrorCodes.PARSE_ERROR,
    line
  );
}

/**
 * Create a "no module found" error.
 */
export function noModuleError(): FSMExtractionError {
  return new FSMExtractionError(
    'No module declaration found in input',
    ErrorCodes.NO_MODULE,
    undefined,
    'Make sure your input contains a valid SystemVerilog module.'
  );
}

/**
 * Create a "no FSM found" error.
 */
export function noFSMError(): FSMExtractionError {
  return new FSMExtractionError(
    'No FSM detected in the module',
    ErrorCodes.NO_FSM,
    undefined,
    'Could not find a typedef enum with state definitions or a case statement on a state variable.\n' +
    'Supported patterns:\n' +
    '  - typedef enum { STATE1, STATE2, ... } state_t;\n' +
    '  - case (state) STATE1: ... STATE2: ... endcase'
  );
}

/**
 * Create a "no states found" error.
 */
export function noStatesError(): FSMExtractionError {
  return new FSMExtractionError(
    'No states found in the FSM',
    ErrorCodes.NO_STATES,
    undefined,
    'Could not find any state definitions. Make sure you have:\n' +
    '  - A typedef enum with state names, or\n' +
    '  - Case labels that look like state names (e.g., IDLE, RUN, DONE)'
  );
}

/**
 * Create a "no transitions found" error.
 */
export function noTransitionsError(): FSMExtractionError {
  return new FSMExtractionError(
    'No transitions found in the FSM',
    ErrorCodes.NO_TRANSITIONS,
    undefined,
    'Could not find any state transitions. Make sure you have:\n' +
    '  - Assignments to next_state or state variable\n' +
    '  - A case statement switching on the state variable'
  );
}

/**
 * Create an invalid input error.
 */
export function invalidInputError(message: string): FSMExtractionError {
  return new FSMExtractionError(
    `Invalid input: ${message}`,
    ErrorCodes.INVALID_INPUT
  );
}

/**
 * Create a WASM initialization error.
 */
export function wasmInitError(message: string): FSMExtractionError {
  return new FSMExtractionError(
    `Failed to initialize parser: ${message}`,
    ErrorCodes.WASM_INIT,
    undefined,
    'Make sure the WASM files are available:\n' +
    '  - tree-sitter.wasm\n' +
    '  - tree-sitter-systemverilog.wasm'
  );
}

/**
 * Create an unsupported pattern error.
 */
export function unsupportedPatternError(pattern: string, line?: number): FSMExtractionError {
  return new FSMExtractionError(
    `Unsupported FSM pattern: ${pattern}`,
    ErrorCodes.UNSUPPORTED_PATTERN,
    line,
    'This tool supports common FSM patterns but not all.\n' +
    'See documentation for supported patterns.'
  );
}

/**
 * Format an error for display.
 */
export function formatError(error: Error | FSMExtractionError): string {
  if (error instanceof FSMExtractionError) {
    return error.toString();
  }
  return error.message;
}

/**
 * Check if an error is recoverable (we can still produce partial output).
 */
export function isRecoverableError(error: Error): boolean {
  if (error instanceof FSMExtractionError) {
    // These errors might still have partial results
    return [
      ErrorCodes.NO_TRANSITIONS,
      ErrorCodes.UNSUPPORTED_PATTERN,
    ].includes(error.code as any);
  }
  return false;
}
