import type { FSM, FSMWarning, FSMState, FSMTransition } from '../types.js';

/**
 * Validate FSM reachability - find unreachable and terminal states.
 */
export function validateReachability(fsm: FSM): FSMWarning[] {
  const warnings: FSMWarning[] = [];

  // Find unreachable states (no incoming transitions except reset)
  const unreachable = findUnreachableStates(fsm);
  if (unreachable.length > 0) {
    warnings.push({
      type: 'unreachable_state',
      message: `State(s) ${unreachable.join(', ')} have no incoming transitions`,
      states: unreachable,
    });

    // Mark states as unreachable
    for (const stateName of unreachable) {
      const state = fsm.states.find((s) => s.name === stateName);
      if (state) {
        state.isUnreachable = true;
      }
    }
  }

  // Find terminal states (no outgoing transitions except self-loops)
  const terminal = findTerminalStates(fsm);
  if (terminal.length > 0) {
    // Filter out intentional terminal states (like DONE, ERROR, HALT)
    const unintentional = terminal.filter((s) => !isIntentionalTerminal(s));

    if (unintentional.length > 0) {
      warnings.push({
        type: 'terminal_state',
        message: `State(s) ${unintentional.join(', ')} have no outgoing transitions (may be intentional)`,
        states: unintentional,
      });
    }

    // Mark states as terminal
    for (const stateName of terminal) {
      const state = fsm.states.find((s) => s.name === stateName);
      if (state) {
        state.isTerminal = true;
      }
    }
  }

  return warnings;
}

/**
 * Find states with no incoming transitions.
 */
function findUnreachableStates(fsm: FSM): string[] {
  const unreachable: string[] = [];

  // Build set of states that have incoming transitions
  const hasIncoming = new Set<string>();
  for (const transition of fsm.transitions) {
    if (!transition.isSelfLoop) {
      hasIncoming.add(transition.to);
    }
  }

  // Check each state
  for (const state of fsm.states) {
    // Reset state is always reachable
    if (state.name === fsm.resetState) {
      continue;
    }

    if (!hasIncoming.has(state.name)) {
      unreachable.push(state.name);
    }
  }

  return unreachable;
}

/**
 * Find states with no outgoing transitions (except self-loops).
 */
function findTerminalStates(fsm: FSM): string[] {
  const terminal: string[] = [];

  // Build set of states that have outgoing transitions
  const hasOutgoing = new Set<string>();
  for (const transition of fsm.transitions) {
    if (!transition.isSelfLoop) {
      hasOutgoing.add(transition.from);
    }
  }

  // Check each state
  for (const state of fsm.states) {
    if (!hasOutgoing.has(state.name)) {
      terminal.push(state.name);
    }
  }

  return terminal;
}

/**
 * Check if a state name suggests it's an intentional terminal state.
 */
function isIntentionalTerminal(stateName: string): boolean {
  const terminalPatterns = [
    /done/i,
    /complete/i,
    /finish/i,
    /end/i,
    /halt/i,
    /stop/i,
    /final/i,
    /error/i,
    /fail/i,
    /dead/i,
  ];

  return terminalPatterns.some((pattern) => pattern.test(stateName));
}

/**
 * Check if FSM is strongly connected (all states reachable from reset).
 */
export function isStronglyConnected(fsm: FSM): boolean {
  if (!fsm.resetState) {
    return false;
  }

  const reachable = findReachableStates(fsm, fsm.resetState);
  return reachable.size === fsm.states.length;
}

/**
 * Find all states reachable from a given starting state.
 */
export function findReachableStates(fsm: FSM, startState: string): Set<string> {
  const reachable = new Set<string>();
  const queue = [startState];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) {
      continue;
    }
    reachable.add(current);

    // Find all states reachable from current
    for (const transition of fsm.transitions) {
      if (transition.from === current && !reachable.has(transition.to)) {
        queue.push(transition.to);
      }
    }
  }

  return reachable;
}

/**
 * Check for cycles in the FSM.
 */
export function findCycles(fsm: FSM): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  for (const state of fsm.states) {
    adjacency.set(state.name, []);
  }
  for (const transition of fsm.transitions) {
    if (!transition.isSelfLoop) {
      adjacency.get(transition.from)?.push(transition.to);
    }
  }

  // DFS to find cycles
  function dfs(state: string): void {
    visited.add(state);
    recursionStack.add(state);
    path.push(state);

    const neighbors = adjacency.get(state) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recursionStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart);
        cycle.push(neighbor); // Complete the cycle
        cycles.push(cycle);
      }
    }

    path.pop();
    recursionStack.delete(state);
  }

  // Start DFS from each unvisited state
  for (const state of fsm.states) {
    if (!visited.has(state.name)) {
      dfs(state.name);
    }
  }

  return cycles;
}
