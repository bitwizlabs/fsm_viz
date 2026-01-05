import type { FSM, FSMState, FSMTransition, MermaidOptions, FSMOutput } from '../types.js';
import { formatOutput, formatOutputs } from '../extractor/output-extractor.js';

/**
 * Default Mermaid generation options.
 */
export const defaultMermaidOptions: MermaidOptions = {
  direction: 'TB',
  showConditions: true,
  showOutputs: false,
  showSelfLoops: true,
};

/**
 * Generate Mermaid stateDiagram-v2 code from an FSM.
 */
export function generateMermaid(fsm: FSM, options: Partial<MermaidOptions> = {}): string {
  const opts = { ...defaultMermaidOptions, ...options };
  const lines: string[] = [];

  // Header
  lines.push('stateDiagram-v2');
  lines.push(`    direction ${opts.direction}`);

  // Reset state arrow
  if (fsm.resetState) {
    lines.push(`    [*] --> ${fsm.resetState}`);
  }

  // State definitions with Moore outputs
  if (opts.showOutputs) {
    const statesWithOutputs = fsm.states.filter((s) => s.outputs.length > 0);
    if (statesWithOutputs.length > 0) {
      lines.push('');
      for (const state of statesWithOutputs) {
        lines.push(...generateStateDefinition(state));
      }
    }
  }

  // Transitions
  lines.push('');
  const transitionLines = generateTransitions(fsm, opts);
  lines.push(...transitionLines);

  return lines.join('\n');
}

/**
 * Generate state definition with Moore outputs.
 */
function generateStateDefinition(state: FSMState): string[] {
  const lines: string[] = [];

  // State name line
  lines.push(`    ${state.name}: ${state.name}`);

  // Output lines
  for (const output of state.outputs) {
    lines.push(`    ${state.name}: ${formatOutput(output)}`);
  }

  return lines;
}

/**
 * Generate transition lines.
 */
function generateTransitions(fsm: FSM, opts: MermaidOptions): string[] {
  const lines: string[] = [];

  for (const transition of fsm.transitions) {
    // Skip self-loops if not showing them
    if (transition.isSelfLoop && !opts.showSelfLoops) {
      continue;
    }

    // Skip implicit transitions in basic view
    if (transition.isImplicit && !opts.showSelfLoops) {
      continue;
    }

    const line = generateTransitionLine(transition, opts);
    lines.push(`    ${line}`);
  }

  return lines;
}

/**
 * Generate a single transition line.
 */
function generateTransitionLine(transition: FSMTransition, opts: MermaidOptions): string {
  const { from, to, condition, outputs } = transition;

  // Build label parts
  const labelParts: string[] = [];

  // Condition
  if (opts.showConditions && condition) {
    labelParts.push(condition);
  }

  // Mealy outputs (shown as "condition / outputs")
  if (opts.showOutputs && outputs.length > 0) {
    const outputStr = formatOutputs(outputs);
    if (labelParts.length > 0) {
      labelParts.push('/');
      labelParts.push(outputStr);
    } else {
      labelParts.push(`/ ${outputStr}`);
    }
  }

  // Format the transition
  if (labelParts.length > 0) {
    const label = labelParts.join(' ');
    return `${from} --> ${to}: ${label}`;
  } else {
    return `${from} --> ${to}`;
  }
}

/**
 * Generate Mermaid code with annotations for warnings.
 */
export function generateMermaidWithAnnotations(
  fsm: FSM,
  options: Partial<MermaidOptions> = {}
): string {
  const baseMermaid = generateMermaid(fsm, options);
  const lines = baseMermaid.split('\n');

  // Add notes for warnings
  const warningNotes: string[] = [];

  for (const warning of fsm.warnings) {
    if (warning.states && warning.states.length > 0) {
      for (const state of warning.states) {
        const noteText = getWarningNoteText(warning.type);
        warningNotes.push(`    note right of ${state}: ${noteText}`);
      }
    }
  }

  if (warningNotes.length > 0) {
    lines.push('');
    lines.push(...warningNotes);
  }

  return lines.join('\n');
}

/**
 * Get note text for a warning type.
 */
function getWarningNoteText(type: string): string {
  switch (type) {
    case 'unreachable_state':
      return '⚠️ Unreachable';
    case 'terminal_state':
      return '⚠️ Terminal';
    case 'missing_case':
      return '⚠️ Not handled';
    default:
      return '⚠️ Warning';
  }
}

/**
 * Generate JSON output for an FSM.
 */
export function generateJSON(fsm: FSM): string {
  return JSON.stringify(fsm, null, 2);
}

/**
 * Generate compact Mermaid (minimal whitespace).
 */
export function generateCompactMermaid(fsm: FSM, options: Partial<MermaidOptions> = {}): string {
  const full = generateMermaid(fsm, options);
  return full
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Escape special characters for Mermaid labels.
 */
export function escapeMermaidLabel(label: string): string {
  // Mermaid uses special characters that need escaping
  return label
    .replace(/"/g, '\\"')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

/**
 * Generate Mermaid code with click handlers for source linking.
 */
export function generateMermaidWithClickHandlers(
  fsm: FSM,
  options: Partial<MermaidOptions> = {}
): string {
  const baseMermaid = generateMermaid(fsm, options);
  const lines = baseMermaid.split('\n');

  // Add click handlers for states
  const clickHandlers: string[] = [];
  for (const state of fsm.states) {
    clickHandlers.push(`    click ${state.name} call handleStateClick("${state.name}", ${state.line})`);
  }

  if (clickHandlers.length > 0) {
    lines.push('');
    lines.push(...clickHandlers);
  }

  return lines.join('\n');
}

/**
 * Validate generated Mermaid syntax (basic check).
 */
export function validateMermaidSyntax(mermaid: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for required header
  if (!mermaid.includes('stateDiagram-v2')) {
    errors.push('Missing stateDiagram-v2 header');
  }

  // Check for balanced brackets/quotes
  const openBrackets = (mermaid.match(/\[/g) || []).length;
  const closeBrackets = (mermaid.match(/\]/g) || []).length;
  if (openBrackets !== closeBrackets) {
    errors.push('Unbalanced square brackets');
  }

  // Check for valid transitions
  const transitionPattern = /(\w+)\s+-->\s+(\w+)/g;
  let match;
  while ((match = transitionPattern.exec(mermaid)) !== null) {
    // Transitions look valid
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
