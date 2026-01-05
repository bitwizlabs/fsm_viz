import type { SyntaxNode } from '../parser/ast-walker.js';
import {
  findNodesOfType,
  getNodeText,
  getNodeLine,
} from '../parser/ast-walker.js';
import type { EnumDefinition, StateRegister, AlwaysBlock, FSM } from '../types.js';
import { detectEnumDefinitions, looksLikeFSMEnum, detectEncodingType } from './enum-detector.js';
import { detectStateRegisters, matchStateRegisterPairs, findStateRegistersForEnum } from './register-detector.js';
import { analyzeAlwaysBlocks, findStateCaseStatements, detectBlockStyle, getTransitionBlock } from './always-analyzer.js';
import { extractTransitions, extractResetState } from './transition-builder.js';
import { extractOutputsFromCaseStatement, attachOutputsToTransitions } from './output-extractor.js';

/**
 * Detect and extract multiple FSMs from a module.
 */
export function detectMultipleFSMs(root: SyntaxNode): FSM[] {
  const fsms: FSM[] = [];

  // Step 1: Find all enum definitions
  const enumDefs = detectEnumDefinitions(root);

  // Step 2: Filter to likely FSM enums
  const fsmEnums = enumDefs.filter(looksLikeFSMEnum);

  // Step 3: Find state registers
  const allRegisters = detectStateRegisters(root, enumDefs);

  // Step 4: Match registers to pairs
  const registerPairs = matchStateRegisterPairs(allRegisters);

  // Step 5: Analyze always blocks
  const alwaysBlocks = analyzeAlwaysBlocks(root, allRegisters);

  // Step 6: For each FSM enum, try to build an FSM
  for (const enumDef of fsmEnums) {
    const fsm = buildFSMFromEnum(
      enumDef,
      registerPairs,
      alwaysBlocks,
      root
    );
    if (fsm) {
      fsms.push(fsm);
    }
  }

  // If no typed FSMs found, try to detect untyped FSMs
  if (fsms.length === 0 && registerPairs.length > 0) {
    for (const pair of registerPairs) {
      const fsm = buildFSMFromRegisters(pair, alwaysBlocks, root);
      if (fsm) {
        fsms.push(fsm);
      }
    }
  }

  return fsms;
}

/**
 * Build an FSM from an enum definition.
 */
function buildFSMFromEnum(
  enumDef: EnumDefinition,
  registerPairs: Array<{ state: StateRegister; nextState?: StateRegister }>,
  alwaysBlocks: AlwaysBlock[],
  root: SyntaxNode
): FSM | null {
  // Find matching registers
  const pair = findStateRegistersForEnum(enumDef, registerPairs);
  if (!pair) {
    return null;
  }

  const stateVarName = pair.state.varName;
  const nextStateVarName = pair.nextState?.varName || stateVarName;
  const stateNames = new Set(enumDef.states.map((s) => s.name));

  // Detect block style
  const blockStyle = detectBlockStyle(alwaysBlocks, stateVarName, nextStateVarName);

  // Find the transition block
  const transitionBlock = getTransitionBlock(alwaysBlocks, stateVarName, nextStateVarName);
  if (!transitionBlock) {
    return null;
  }

  // Find case statements on state variable
  const transitionBlockNode = findAlwaysBlockNode(root, transitionBlock.line);
  if (!transitionBlockNode) {
    return null;
  }

  const caseStatements = findStateCaseStatements(transitionBlockNode, new Set([stateVarName, nextStateVarName]));
  if (caseStatements.length === 0) {
    return null;
  }

  // Extract transitions from the first case statement
  const caseStmt = caseStatements[0];
  const { transitions, hasDefaultAssignment } = extractTransitions(
    caseStmt,
    stateVarName,
    nextStateVarName,
    stateNames,
    transitionBlock.type
  );

  // Extract outputs
  const outputsResult = extractOutputsFromCaseStatement(
    caseStmt,
    stateVarName,
    nextStateVarName,
    stateNames
  );

  // Attach Mealy outputs to transitions
  attachOutputsToTransitions(transitions, outputsResult.mealyOutputsByTransition);

  // Find reset state
  const ffBlock = alwaysBlocks.find(
    (b) => b.type === 'always_ff' && b.stateAssignments.includes(stateVarName)
  );
  let resetState: string | undefined;
  if (ffBlock) {
    const ffNode = findAlwaysBlockNode(root, ffBlock.line);
    if (ffNode) {
      resetState = extractResetState(ffNode, stateVarName, stateNames) || undefined;
    }
  }
  // Fallback to first state
  if (!resetState && enumDef.states.length > 0) {
    resetState = enumDef.states[0].name;
  }

  // Build states with Moore outputs
  const states = enumDef.states.map((s) => ({
    name: s.name,
    encoding: s.encoding,
    line: s.line,
    outputs: outputsResult.mooreOutputsByState.get(s.name) || [],
  }));

  // Calculate confidence
  const confidence = calculateConfidence(
    enumDef,
    transitions,
    resetState,
    outputsResult
  );

  return {
    name: enumDef.typeName,
    states,
    transitions,
    resetState,
    encoding: detectEncodingType(enumDef),
    stateVarName,
    nextStateVarName: pair.nextState ? nextStateVarName : undefined,
    blockStyle,
    confidence: confidence.overall,
    confidenceBreakdown: confidence.breakdown,
    warnings: [],
    errors: [],
    inputSignals: outputsResult.inputSignals,
    outputSignals: outputsResult.outputSignals,
  };
}

/**
 * Build an FSM from register pairs (when no typed enum found).
 */
function buildFSMFromRegisters(
  pair: { state: StateRegister; nextState?: StateRegister },
  alwaysBlocks: AlwaysBlock[],
  root: SyntaxNode
): FSM | null {
  // This is a lower-confidence extraction
  // We need to infer states from case labels
  const stateVarName = pair.state.varName;
  const nextStateVarName = pair.nextState?.varName || stateVarName;

  // Find the transition block
  const transitionBlock = getTransitionBlock(alwaysBlocks, stateVarName, nextStateVarName);
  if (!transitionBlock) {
    return null;
  }

  const transitionBlockNode = findAlwaysBlockNode(root, transitionBlock.line);
  if (!transitionBlockNode) {
    return null;
  }

  const caseStatements = findStateCaseStatements(transitionBlockNode, new Set([stateVarName, nextStateVarName]));
  if (caseStatements.length === 0) {
    return null;
  }

  // Infer states from case labels
  const stateNames = inferStatesFromCase(caseStatements[0]);
  if (stateNames.size === 0) {
    return null;
  }

  // Extract transitions
  const { transitions } = extractTransitions(
    caseStatements[0],
    stateVarName,
    nextStateVarName,
    stateNames,
    transitionBlock.type
  );

  const states = Array.from(stateNames).map((name) => ({
    name,
    line: getNodeLine(caseStatements[0]),
    outputs: [],
  }));

  return {
    name: stateVarName,
    states,
    transitions,
    encoding: 'unknown',
    stateVarName,
    nextStateVarName: pair.nextState ? nextStateVarName : undefined,
    blockStyle: detectBlockStyle(alwaysBlocks, stateVarName, nextStateVarName),
    confidence: 0.5,
    confidenceBreakdown: {
      stateDetection: 0.5,
      transitionExtraction: 0.6,
      resetDetection: 0.3,
      outputExtraction: 0.4,
    },
    warnings: [],
    errors: [],
    inputSignals: [],
    outputSignals: [],
  };
}

/**
 * Find an always block node by line number.
 */
function findAlwaysBlockNode(root: SyntaxNode, line: number): SyntaxNode | null {
  const alwaysNodes = findNodesOfType(root, 'always_construct');
  for (const node of alwaysNodes) {
    if (getNodeLine(node) === line) {
      return node;
    }
  }
  return null;
}

/**
 * Infer state names from case statement labels.
 */
function inferStatesFromCase(caseStmt: SyntaxNode): Set<string> {
  const states = new Set<string>();
  const text = getNodeText(caseStmt);

  // Look for case item labels
  const caseItems = findNodesOfType(caseStmt, 'case_item');
  for (const item of caseItems) {
    const itemText = getNodeText(item);
    const colonIndex = itemText.indexOf(':');
    if (colonIndex > 0) {
      const label = itemText.substring(0, colonIndex).trim();
      // Filter out 'default'
      if (label.toLowerCase() !== 'default') {
        // Check if it looks like a state name (uppercase identifier)
        if (/^[A-Z_][A-Z0-9_]*$/.test(label)) {
          states.add(label);
        }
      }
    }
  }

  return states;
}

/**
 * Calculate extraction confidence.
 */
function calculateConfidence(
  enumDef: EnumDefinition,
  transitions: any[],
  resetState: string | undefined,
  outputsResult: any
): { overall: number; breakdown: { stateDetection: number; transitionExtraction: number; resetDetection: number; outputExtraction: number } } {
  const breakdown = {
    stateDetection: 1.0, // Found typedef enum
    transitionExtraction: 0.8,
    resetDetection: resetState ? 1.0 : 0.5,
    outputExtraction: 0.7,
  };

  // Adjust transition confidence based on coverage
  const coveredStates = new Set(transitions.map((t) => t.from));
  const coverage = coveredStates.size / enumDef.states.length;
  breakdown.transitionExtraction = Math.min(1.0, coverage + 0.2);

  // Adjust output confidence
  if (outputsResult.outputSignals.length > 0 || outputsResult.inputSignals.length > 0) {
    breakdown.outputExtraction = 0.9;
  }

  const overall = (
    breakdown.stateDetection * 0.3 +
    breakdown.transitionExtraction * 0.4 +
    breakdown.resetDetection * 0.15 +
    breakdown.outputExtraction * 0.15
  );

  return { overall, breakdown };
}

/**
 * Get module name from the root AST node.
 */
export function getModuleName(root: SyntaxNode): string | null {
  const moduleNodes = findNodesOfType(root, 'module_declaration');
  if (moduleNodes.length === 0) {
    return null;
  }

  const moduleText = getNodeText(moduleNodes[0]);
  const match = moduleText.match(/module\s+(\w+)/i);
  return match ? match[1] : null;
}
