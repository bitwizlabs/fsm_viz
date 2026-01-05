/**
 * fsm_viz - Extract FSM state machines from SystemVerilog and generate Mermaid diagrams.
 */

// Parser
export { initParser, parseSystemVerilog, resetParser } from './parser/tree-sitter-init.js';

// Extractors
export { detectEnumDefinitions, looksLikeFSMEnum, detectEncodingType } from './extractor/enum-detector.js';
export { detectStateRegisters, matchStateRegisterPairs, findStateRegistersForEnum } from './extractor/register-detector.js';
export { analyzeAlwaysBlocks, findStateCaseStatements, detectBlockStyle, getTransitionBlock } from './extractor/always-analyzer.js';
export { extractTransitions, extractResetState, simplifyCondition } from './extractor/transition-builder.js';
export { extractMooreOutputs, extractMealyOutputs, extractOutputsFromCaseStatement, attachOutputsToTransitions, formatOutput, formatOutputs } from './extractor/output-extractor.js';
export { detectMultipleFSMs, getModuleName } from './extractor/multi-fsm-detector.js';

// Validators
export { validateReachability, isStronglyConnected, findReachableStates, findCycles } from './validator/reachability.js';
export { validateCoverage, checkTransitionCoverage, validateTransitionTargets, findDuplicateTransitions, checkNonDeterminism, generateValidationSummary } from './validator/coverage.js';

// Generators
export { generateMermaid, generateMermaidWithAnnotations, generateJSON, generateCompactMermaid, generateMermaidWithClickHandlers, validateMermaidSyntax, defaultMermaidOptions } from './generator/mermaid.js';

// Types
export * from './types.js';

// Errors
export * from './errors.js';

// High-level API
import { parseSystemVerilog } from './parser/tree-sitter-init.js';
import { detectMultipleFSMs, getModuleName } from './extractor/multi-fsm-detector.js';
import { validateReachability } from './validator/reachability.js';
import { validateCoverage } from './validator/coverage.js';
import { generateMermaid, generateJSON, defaultMermaidOptions } from './generator/mermaid.js';
import { noFSMError, noModuleError } from './errors.js';
import type { FSM, ModuleAnalysis, MermaidOptions, ExtractOptions } from './types.js';

/**
 * Extract FSMs from SystemVerilog source code.
 *
 * @param source - SystemVerilog source code
 * @returns ModuleAnalysis containing detected FSMs
 */
export async function extractFSMs(source: string): Promise<ModuleAnalysis> {
  // Parse the source
  const tree = await parseSystemVerilog(source);
  const root = tree.rootNode;

  // Get module name
  const moduleName = getModuleName(root) || 'unknown';

  // Detect FSMs
  const fsms = detectMultipleFSMs(root);

  // Validate each FSM
  for (const fsm of fsms) {
    const reachabilityWarnings = validateReachability(fsm);
    const coverageWarnings = validateCoverage(fsm);
    fsm.warnings.push(...reachabilityWarnings, ...coverageWarnings);
  }

  return {
    moduleName,
    fsms,
    parseErrors: [],
  };
}

/**
 * Extract a single FSM and generate Mermaid output.
 *
 * @param source - SystemVerilog source code
 * @param options - Mermaid generation options
 * @returns Mermaid diagram string or error
 */
export async function extractAndGenerateMermaid(
  source: string,
  options: Partial<MermaidOptions> = {}
): Promise<{ mermaid: string; fsm: FSM; warnings: string[] }> {
  const analysis = await extractFSMs(source);

  if (analysis.fsms.length === 0) {
    throw noFSMError();
  }

  const fsm = analysis.fsms[0];
  const mermaid = generateMermaid(fsm, options);
  const warnings = fsm.warnings.map((w) => w.message);

  return { mermaid, fsm, warnings };
}

/**
 * Extract FSM and generate output in specified format.
 *
 * @param source - SystemVerilog source code
 * @param options - Extract options
 * @returns Output string in requested format
 */
export async function extract(
  source: string,
  options: Partial<ExtractOptions> = {}
): Promise<string> {
  const opts: ExtractOptions = {
    format: 'mermaid',
    direction: 'TB',
    conditions: true,
    outputs: false,
    warnings: false,
    ...options,
  };

  const analysis = await extractFSMs(source);

  if (analysis.fsms.length === 0) {
    throw noFSMError();
  }

  // Select FSM
  let fsm: FSM;
  if (opts.fsm) {
    const found = analysis.fsms.find((f) => f.name === opts.fsm);
    if (!found) {
      throw new Error(`FSM '${opts.fsm}' not found. Available: ${analysis.fsms.map((f) => f.name).join(', ')}`);
    }
    fsm = found;
  } else {
    fsm = analysis.fsms[0];
  }

  // Generate output
  if (opts.format === 'json') {
    return generateJSON(fsm);
  }

  const mermaidOptions: MermaidOptions = {
    direction: opts.direction,
    showConditions: opts.conditions,
    showOutputs: opts.outputs,
    showSelfLoops: true,
  };

  let output = generateMermaid(fsm, mermaidOptions);

  // Add warnings as comments if requested
  if (opts.warnings && fsm.warnings.length > 0) {
    const warningLines = fsm.warnings.map((w) => `%% WARNING: ${w.message}`);
    output = warningLines.join('\n') + '\n\n' + output;
  }

  return output;
}

/**
 * Quick check if source might contain an FSM.
 *
 * This is a fast heuristic check, not a full parse.
 */
export function mightContainFSM(source: string): boolean {
  // Look for common FSM patterns
  const patterns = [
    /typedef\s+enum/i,
    /\bstate\b.*\bcase\b/is,
    /\bfsm\b/i,
    /\bnext_state\b/i,
    /\balways_ff\b.*state/is,
    /\balways_comb\b.*state/is,
  ];

  return patterns.some((p) => p.test(source));
}
