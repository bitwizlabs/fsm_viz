import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSystemVerilog } from '../src/parser/tree-sitter-init.js';
import { findNodesOfType, getNodeText } from '../src/parser/ast-walker.js';
import { mightContainFSM } from '../src/index.js';

const fixturesDir = join(import.meta.dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

describe('mightContainFSM', () => {
  it('should detect FSM patterns in source', () => {
    const source = `
      typedef enum logic [1:0] {IDLE, RUN} state_t;
      state_t state;
    `;
    expect(mightContainFSM(source)).toBe(true);
  });

  it('should return false for non-FSM code', () => {
    const source = `
      module adder(input a, input b, output sum);
        assign sum = a + b;
      endmodule
    `;
    expect(mightContainFSM(source)).toBe(false);
  });

  it('should detect Verilog FSM patterns', () => {
    const source = loadFixture('verilog-fsm.sv');
    // This should be detected as potentially containing FSM
    expect(mightContainFSM(source)).toBe(true);
  });
});

describe('Parser initialization', () => {
  it('should parse Verilog code', async () => {
    const source = loadFixture('verilog-fsm.sv');
    const tree = await parseSystemVerilog(source);
    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
  });

  it('should find module declaration', async () => {
    const source = loadFixture('verilog-fsm.sv');
    const tree = await parseSystemVerilog(source);
    const modules = findNodesOfType(tree.rootNode, 'module_declaration');
    expect(modules.length).toBe(1);
  });

  it('should find always constructs', async () => {
    const source = loadFixture('verilog-fsm.sv');
    const tree = await parseSystemVerilog(source);
    const always = findNodesOfType(tree.rootNode, 'always_construct');
    expect(always.length).toBe(2);
  });

  it('should find case statement', async () => {
    const source = loadFixture('verilog-fsm.sv');
    const tree = await parseSystemVerilog(source);
    const cases = findNodesOfType(tree.rootNode, 'case_statement');
    expect(cases.length).toBe(1);
  });

  it('should find parameter declarations', async () => {
    const source = loadFixture('verilog-fsm.sv');
    const tree = await parseSystemVerilog(source);
    const params = findNodesOfType(tree.rootNode, 'parameter_declaration');
    expect(params.length).toBe(3); // IDLE, RUN, DONE_STATE
  });
});

describe('AST Walker utilities', () => {
  it('should extract node text', async () => {
    const source = loadFixture('verilog-fsm.sv');
    const tree = await parseSystemVerilog(source);
    const modules = findNodesOfType(tree.rootNode, 'module_declaration');
    expect(getNodeText(modules[0])).toContain('simple_fsm');
  });

  it('should find nested nodes', async () => {
    const source = loadFixture('verilog-fsm.sv');
    const tree = await parseSystemVerilog(source);

    // Find case items inside case statement
    const cases = findNodesOfType(tree.rootNode, 'case_statement');
    expect(cases.length).toBe(1);

    const caseItems = findNodesOfType(cases[0], 'case_item');
    expect(caseItems.length).toBeGreaterThan(0);
  });
});

describe('Mermaid generation (unit tests)', () => {
  it('should generate stateDiagram header', async () => {
    const { generateMermaid } = await import('../src/generator/mermaid.js');

    // Create a minimal FSM object
    const fsm = {
      name: 'test_fsm',
      states: [
        { name: 'IDLE', line: 1, outputs: [] },
        { name: 'RUN', line: 2, outputs: [] },
      ],
      transitions: [
        { from: 'IDLE', to: 'RUN', line: 3, sourceBlock: 'always_comb' as const, outputs: [] },
        { from: 'RUN', to: 'IDLE', line: 4, sourceBlock: 'always_comb' as const, outputs: [] },
      ],
      resetState: 'IDLE',
      encoding: 'binary' as const,
      stateVarName: 'state',
      blockStyle: 'two-block' as const,
      confidence: 0.9,
      confidenceBreakdown: {
        stateDetection: 1.0,
        transitionExtraction: 0.8,
        resetDetection: 1.0,
        outputExtraction: 0.8,
      },
      warnings: [],
      errors: [],
      inputSignals: [],
      outputSignals: [],
    };

    const mermaid = generateMermaid(fsm);
    expect(mermaid).toContain('stateDiagram-v2');
    expect(mermaid).toContain('[*] --> IDLE');
    expect(mermaid).toContain('IDLE --> RUN');
    expect(mermaid).toContain('RUN --> IDLE');
  });

  it('should respect direction option', async () => {
    const { generateMermaid } = await import('../src/generator/mermaid.js');

    const fsm = {
      name: 'test_fsm',
      states: [{ name: 'IDLE', line: 1, outputs: [] }],
      transitions: [],
      resetState: 'IDLE',
      encoding: 'binary' as const,
      stateVarName: 'state',
      blockStyle: 'two-block' as const,
      confidence: 0.9,
      confidenceBreakdown: {
        stateDetection: 1.0,
        transitionExtraction: 0.8,
        resetDetection: 1.0,
        outputExtraction: 0.8,
      },
      warnings: [],
      errors: [],
      inputSignals: [],
      outputSignals: [],
    };

    const mermaidTB = generateMermaid(fsm, { direction: 'TB' });
    const mermaidLR = generateMermaid(fsm, { direction: 'LR' });

    expect(mermaidTB).toContain('direction TB');
    expect(mermaidLR).toContain('direction LR');
  });

  it('should include conditions when requested', async () => {
    const { generateMermaid } = await import('../src/generator/mermaid.js');

    const fsm = {
      name: 'test_fsm',
      states: [
        { name: 'IDLE', line: 1, outputs: [] },
        { name: 'RUN', line: 2, outputs: [] },
      ],
      transitions: [
        {
          from: 'IDLE',
          to: 'RUN',
          condition: 'start',
          line: 3,
          sourceBlock: 'always_comb' as const,
          outputs: [],
        },
      ],
      resetState: 'IDLE',
      encoding: 'binary' as const,
      stateVarName: 'state',
      blockStyle: 'two-block' as const,
      confidence: 0.9,
      confidenceBreakdown: {
        stateDetection: 1.0,
        transitionExtraction: 0.8,
        resetDetection: 1.0,
        outputExtraction: 0.8,
      },
      warnings: [],
      errors: [],
      inputSignals: [],
      outputSignals: [],
    };

    const mermaid = generateMermaid(fsm, { showConditions: true });
    expect(mermaid).toContain('IDLE --> RUN: start');
  });
});

describe('Validator unit tests', () => {
  it('should detect unreachable states', async () => {
    const { validateReachability } = await import('../src/validator/reachability.js');

    const fsm = {
      name: 'test_fsm',
      states: [
        { name: 'IDLE', line: 1, outputs: [] },
        { name: 'RUN', line: 2, outputs: [] },
        { name: 'ORPHAN', line: 3, outputs: [] },
      ],
      transitions: [
        { from: 'IDLE', to: 'RUN', line: 4, sourceBlock: 'always_comb' as const, outputs: [] },
        { from: 'RUN', to: 'IDLE', line: 5, sourceBlock: 'always_comb' as const, outputs: [] },
        // ORPHAN has no incoming transitions
      ],
      resetState: 'IDLE',
      encoding: 'binary' as const,
      stateVarName: 'state',
      blockStyle: 'two-block' as const,
      confidence: 0.9,
      confidenceBreakdown: {
        stateDetection: 1.0,
        transitionExtraction: 0.8,
        resetDetection: 1.0,
        outputExtraction: 0.8,
      },
      warnings: [],
      errors: [],
      inputSignals: [],
      outputSignals: [],
    };

    const warnings = validateReachability(fsm);
    const unreachableWarning = warnings.find((w) => w.type === 'unreachable_state');
    expect(unreachableWarning).toBeDefined();
    expect(unreachableWarning?.states).toContain('ORPHAN');
  });

  it('should detect terminal states', async () => {
    const { validateReachability } = await import('../src/validator/reachability.js');

    const fsm = {
      name: 'test_fsm',
      states: [
        { name: 'IDLE', line: 1, outputs: [] },
        { name: 'RUN', line: 2, outputs: [] },
        { name: 'STUCK', line: 3, outputs: [] },
      ],
      transitions: [
        { from: 'IDLE', to: 'RUN', line: 4, sourceBlock: 'always_comb' as const, outputs: [] },
        { from: 'RUN', to: 'STUCK', line: 5, sourceBlock: 'always_comb' as const, outputs: [] },
        // STUCK has no outgoing transitions
      ],
      resetState: 'IDLE',
      encoding: 'binary' as const,
      stateVarName: 'state',
      blockStyle: 'two-block' as const,
      confidence: 0.9,
      confidenceBreakdown: {
        stateDetection: 1.0,
        transitionExtraction: 0.8,
        resetDetection: 1.0,
        outputExtraction: 0.8,
      },
      warnings: [],
      errors: [],
      inputSignals: [],
      outputSignals: [],
    };

    const warnings = validateReachability(fsm);
    const terminalWarning = warnings.find((w) => w.type === 'terminal_state');
    expect(terminalWarning).toBeDefined();
    expect(terminalWarning?.states).toContain('STUCK');
  });
});
