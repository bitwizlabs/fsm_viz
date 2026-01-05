# fsm_viz - Implementation Plan

## Overview

A tool that extracts FSM state machines from SystemVerilog code and outputs Mermaid diagrams.

**Target**: Common FSM patterns (80% coverage - enum states, case statements, 1-2 always blocks)
**Platforms**: CLI + Web
**Output**: Mermaid stateDiagram syntax

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Single codebase for CLI + web |
| Parser | tree-sitter-verilog | WASM for browser, native for Node |
| CLI | Commander.js | Simple, well-documented |
| Diagram | Mermaid.js | Renders in browser, portable syntax |
| Build | esbuild/Vite | WASM bundling support |
| Tests | Vitest | Works for browser + node |

---

## Project Structure

```
fsm_viz/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # Main library export
│   ├── parser/
│   │   ├── tree-sitter-init.ts  # WASM/native initialization
│   │   └── ast-walker.ts        # Tree traversal utilities
│   ├── extractor/
│   │   ├── enum-detector.ts     # typedef enum state detection
│   │   ├── register-detector.ts # State register identification
│   │   ├── always-analyzer.ts   # always_ff/always_comb parsing
│   │   └── transition-builder.ts# State transition extraction
│   ├── generator/
│   │   └── mermaid.ts           # Mermaid stateDiagram output
│   └── types.ts                 # Shared type definitions
├── cli/
│   └── index.ts                 # CLI entry point
├── web/
│   ├── index.html
│   ├── fsm-viz.ts
│   └── style.css
├── wasm/
│   └── tree-sitter-verilog.wasm
└── tests/
    ├── fixtures/                # Sample SV files
    └── *.test.ts
```

---

## Core Data Structures

```typescript
interface FSMState {
  name: string;
  encoding?: string;      // e.g., "2'b00"
  line: number;
  isDefault?: boolean;
}

interface FSMTransition {
  from: string;
  to: string;
  condition?: string;     // Guard (e.g., "start")
  line: number;
}

interface FSM {
  name: string;
  states: FSMState[];
  transitions: FSMTransition[];
  resetState?: string;
  encoding: 'binary' | 'onehot' | 'unknown';
  confidence: number;     // 0-1
  warnings: string[];
}
```

---

## Extraction Algorithm

### Step 1: Parse to AST
```typescript
const tree = parser.parse(source);  // tree-sitter
```

### Step 2: Find State Type Definitions
- Look for: `typedef enum logic [N:0] { STATE1, STATE2, ... } state_t;`
- Extract state names and optional encodings

### Step 3: Find State Registers
- Look for: `state_t state, next_state;`
- Heuristics: variable names containing "state", "fsm", "cs", "ns"

### Step 4: Analyze Always Blocks
- Identify `always_ff` (sequential) vs `always_comb` (combinational)
- Find which blocks touch state registers
- Locate case statements on state variable

### Step 5: Extract Transitions
- For each case item, get current state from label
- Find all assignments to next_state
- Extract conditions from surrounding if/else

### Step 6: Infer Reset State
- Look for `if (!rst_n) state <= IDLE;`
- Fallback: first state in enum

---

## CLI Interface

```
fsm_viz extract <file.sv> [options]

Options:
  -o, --output <file>     Output file (default: stdout)
  -f, --format <format>   mermaid | json (default: mermaid)
  -d, --direction <dir>   TB | LR (default: TB)
  -c, --conditions        Include transition conditions
  -m, --module <name>     Extract specific module only
  -h, --help

Examples:
  fsm_viz extract controller.sv
  fsm_viz extract controller.sv -d LR -c -o fsm.md
```

---

## Example Input/Output

### Input
```systemverilog
typedef enum logic [1:0] {IDLE, RUN, DONE} state_t;
state_t state, next_state;

always_ff @(posedge clk or negedge rst_n)
    if (!rst_n) state <= IDLE;
    else state <= next_state;

always_comb begin
    next_state = state;
    case (state)
        IDLE: if (start) next_state = RUN;
        RUN:  if (done)  next_state = DONE;
        DONE: next_state = IDLE;
    endcase
end
```

### Output (Mermaid)
```
stateDiagram-v2
    direction LR
    [*] --> IDLE
    IDLE --> RUN: start
    RUN --> DONE: done
    DONE --> IDLE
```

---

## Scope

### In Scope (v1)
- `typedef enum` state definitions
- `always_ff` / `always_comb` blocks
- `case` / `casez` / `casex` statements
- `if-else` transition conditions
- Reset state detection
- Mermaid + JSON output
- CLI + Web interfaces

### Out of Scope (v1)
- VHDL
- Hierarchical FSMs
- FSMs split across files
- Visual editor (diagram → code)
- Synthesis attributes

---

## Web UI Design (bitwiz.io/calc Theme)

Must match existing calc aesthetic:

### Visual Style
- Minimal, professional technical aesthetic
- High-contrast text on light background
- Monospace font for code input/output
- Sans-serif for labels and descriptions
- Generous whitespace between sections

### Layout
- Single-column responsive design
- Card-based sections: Input → Results → Help
- Markdown-style headers (##, ###) for sections
- Horizontal dividers between major sections

### Input Section
```
## FSM Visualizer

[SystemVerilog Code]
┌─────────────────────────────────────┐
│ // Paste your FSM code here...      │
│                                     │
│                                     │
└─────────────────────────────────────┘
← Monospace textarea, placeholder text

Direction: [Top to Bottom ▼]  ☑ Show Conditions

[Extract FSM]  [Reset]
```

### Results Section
```
## Results

┌─ Diagram ─────────────────────────┐
│                                   │
│    [Rendered Mermaid SVG]         │
│                                   │
└───────────────────────────────────┘

## Mermaid Code                [Copy]
┌─────────────────────────────────────┐
│ stateDiagram-v2                     │
│     [*] --> IDLE                    │
│     IDLE --> RUN: start             │
└─────────────────────────────────────┘
← Monospace, selectable
```

### Help Section (Progressive Disclosure)
```
## How It Works

**What patterns are detected?**
- `typedef enum` state definitions
- `always_ff` / `always_comb` blocks
- `case` statements with state transitions

**Tips**
- Paste a complete module or just the FSM portion
- Use descriptive state names (IDLE, RUN, DONE)
- Include your reset logic for proper initial state detection
```

### Specific Styling
- **Copy buttons**: Small, right-aligned in result headers
- **Code blocks**: Monospace, subtle background
- **Warnings**: Inline, non-intrusive (like lint warnings)
- **Error messages**: Clear, with line numbers if applicable

---

## Implementation Order

1. **Parser Setup** - TypeScript project, tree-sitter WASM loading
2. **Enum Detector** - Find typedef enum states
3. **Register Detector** - Find state/next_state variables
4. **Always Analyzer** - Parse always blocks, find case statements
5. **Transition Builder** - Extract from/to/condition from case items
6. **Mermaid Generator** - Convert FSM struct to Mermaid syntax
7. **CLI** - File I/O, Commander.js wrapper
8. **Web UI** - Match bitwiz.io/calc theme exactly
9. **Polish** - Edge cases, error messages, tests

---

## Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Parser | tree-sitter (not regex) | Proper AST, handles edge cases |
| Output | Mermaid (not Graphviz) | User-portable, renders anywhere |
| Scope | 80% patterns | Ship fast, iterate on edge cases |
| Architecture | Shared core | One codebase for CLI + web |
