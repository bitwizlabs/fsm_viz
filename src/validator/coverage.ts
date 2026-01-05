import type { FSM, FSMWarning, DetectionMetadata } from '../types.js';

/**
 * Validate FSM case coverage - check for missing cases and implicit defaults.
 */
export function validateCoverage(fsm: FSM, metadata?: DetectionMetadata): FSMWarning[] {
  const warnings: FSMWarning[] = [];

  // Find states not handled in case statement
  const missingCases = findMissingCases(fsm);
  if (missingCases.length > 0) {
    warnings.push({
      type: 'missing_case',
      message: `State(s) ${missingCases.join(', ')} not explicitly handled in case statement`,
      states: missingCases,
    });
  }

  // Check for reset state
  if (!fsm.resetState) {
    warnings.push({
      type: 'no_reset',
      message: 'No reset state detected. Diagram will not show initial state arrow.',
    });
  }

  // Check for implicit defaults (self-loops inferred)
  if (metadata?.hasImplicitSelfLoops) {
    const implicitStates = fsm.transitions
      .filter((t) => t.isImplicit && t.isSelfLoop)
      .map((t) => t.from);

    if (implicitStates.length > 0) {
      warnings.push({
        type: 'implicit_default',
        message: 'Self-loops inferred from default assignment pattern',
        states: [...new Set(implicitStates)],
      });
    }
  }

  return warnings;
}

/**
 * Find states that don't have explicit case handling.
 */
function findMissingCases(fsm: FSM): string[] {
  const missing: string[] = [];

  // Get all states that have explicit transitions defined
  const handledStates = new Set<string>();
  for (const transition of fsm.transitions) {
    if (!transition.isImplicit) {
      handledStates.add(transition.from);
    }
  }

  // Check which states are missing
  for (const state of fsm.states) {
    if (!handledStates.has(state.name)) {
      // Exclude default/implicit self-loop states
      const hasImplicit = fsm.transitions.some(
        (t) => t.from === state.name && t.isImplicit
      );
      if (!hasImplicit) {
        missing.push(state.name);
      }
    }
  }

  return missing;
}

/**
 * Check transition coverage - do all states have defined behavior?
 */
export function checkTransitionCoverage(fsm: FSM): {
  coveredStates: string[];
  uncoveredStates: string[];
  coverage: number;
} {
  const covered = new Set<string>();
  const uncovered: string[] = [];

  for (const transition of fsm.transitions) {
    covered.add(transition.from);
  }

  for (const state of fsm.states) {
    if (!covered.has(state.name)) {
      uncovered.push(state.name);
    }
  }

  return {
    coveredStates: Array.from(covered),
    uncoveredStates: uncovered,
    coverage: fsm.states.length > 0 ? covered.size / fsm.states.length : 0,
  };
}

/**
 * Check if all transitions have valid target states.
 */
export function validateTransitionTargets(fsm: FSM): string[] {
  const errors: string[] = [];
  const stateNames = new Set(fsm.states.map((s) => s.name));

  for (const transition of fsm.transitions) {
    if (!stateNames.has(transition.to)) {
      errors.push(
        `Transition from ${transition.from} targets unknown state '${transition.to}' at line ${transition.line}`
      );
    }
    if (!stateNames.has(transition.from)) {
      errors.push(
        `Transition from unknown state '${transition.from}' at line ${transition.line}`
      );
    }
  }

  return errors;
}

/**
 * Check for duplicate transitions.
 */
export function findDuplicateTransitions(fsm: FSM): Array<{
  from: string;
  to: string;
  count: number;
}> {
  const transitionCounts = new Map<string, number>();

  for (const transition of fsm.transitions) {
    const key = `${transition.from}->${transition.to}:${transition.condition || ''}`;
    transitionCounts.set(key, (transitionCounts.get(key) || 0) + 1);
  }

  const duplicates: Array<{ from: string; to: string; count: number }> = [];
  for (const [key, count] of transitionCounts) {
    if (count > 1) {
      const [fromTo] = key.split(':');
      const [from, to] = fromTo.split('->');
      duplicates.push({ from, to, count });
    }
  }

  return duplicates;
}

/**
 * Check for non-determinism (multiple transitions with overlapping conditions).
 */
export function checkNonDeterminism(fsm: FSM): Array<{
  state: string;
  conditions: string[];
}> {
  // Group transitions by source state
  const byState = new Map<string, typeof fsm.transitions>();
  for (const transition of fsm.transitions) {
    if (!byState.has(transition.from)) {
      byState.set(transition.from, []);
    }
    byState.get(transition.from)!.push(transition);
  }

  const issues: Array<{ state: string; conditions: string[] }> = [];

  for (const [state, transitions] of byState) {
    // Filter to non-default transitions with conditions
    const conditionalTransitions = transitions.filter(
      (t) => !t.isDefault && t.condition
    );

    // If there are multiple conditional transitions to different states,
    // there might be non-determinism (we can't fully check without
    // boolean satisfiability analysis)
    if (conditionalTransitions.length > 1) {
      const toStates = new Set(conditionalTransitions.map((t) => t.to));
      if (toStates.size > 1) {
        // Multiple different targets - potential non-determinism
        // We flag this but note it's not necessarily a problem
        issues.push({
          state,
          conditions: conditionalTransitions.map((t) => t.condition!),
        });
      }
    }
  }

  return issues;
}

/**
 * Generate a summary of FSM validation.
 */
export function generateValidationSummary(fsm: FSM): {
  isValid: boolean;
  issues: string[];
  stats: {
    stateCount: number;
    transitionCount: number;
    hasReset: boolean;
    coverage: number;
  };
} {
  const issues: string[] = [];

  // Check for reset
  if (!fsm.resetState) {
    issues.push('No reset state detected');
  }

  // Check coverage
  const { coverage, uncoveredStates } = checkTransitionCoverage(fsm);
  if (uncoveredStates.length > 0) {
    issues.push(`Uncovered states: ${uncoveredStates.join(', ')}`);
  }

  // Check transition targets
  const targetErrors = validateTransitionTargets(fsm);
  issues.push(...targetErrors);

  // Check for unreachable states
  const unreachable = fsm.states.filter((s) => s.isUnreachable);
  if (unreachable.length > 0) {
    issues.push(`Unreachable states: ${unreachable.map((s) => s.name).join(', ')}`);
  }

  // Add existing warnings
  for (const warning of fsm.warnings) {
    issues.push(warning.message);
  }

  return {
    isValid: issues.length === 0,
    issues,
    stats: {
      stateCount: fsm.states.length,
      transitionCount: fsm.transitions.length,
      hasReset: !!fsm.resetState,
      coverage,
    },
  };
}
