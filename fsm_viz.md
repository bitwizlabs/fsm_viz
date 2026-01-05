# fsm_viz - Implementation Plan

## Overview

A tool that extracts FSM state machines from SystemVerilog code and outputs Mermaid diagrams.

**Target**: Common FSM patterns (50-60% realistic coverage - typedef enum states, case statements, 1-2 always blocks)
**Platforms**: CLI + Web
**Output**: Mermaid stateDiagram syntax

**Key Features**:
- **State & transition extraction** from always blocks and case statements
- **Moore outputs** shown inside state bubbles (e.g., `enable=1`)
- **Mealy outputs** shown on transition arrows (e.g., `start / ack=1`)
- **Multiple FSMs per module** detected and visualized separately
- **Validation warnings** for unreachable states, terminal states, missing case coverage
- **Click-to-source** in web UI to highlight source lines

**Honest Assessment**: This tool handles the "happy path" well. Many real-world FSMs use patterns we don't support (localparam states, package imports). See "Known Limitations" section.

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Single codebase for CLI + web |
| Parser | tree-sitter-systemverilog | IEEE 1800-2023 support, ~3000 tests, actively maintained (gmlarumbe) |
| CLI | Commander.js | Simple, well-documented |
| Diagram | Mermaid.js | Renders in browser, portable syntax |
| Build | esbuild/Vite | WASM bundling support (see WASM Complexity section) |
| Tests | Vitest | Works for browser + node |

**Parser Choice Note**: We chose `tree-sitter-systemverilog` (gmlarumbe) over `tree-sitter-verilog` because:
- tree-sitter-verilog has only 54 tests, last npm publish 2+ years ago
- tree-sitter-systemverilog has ~3000 tests, implements full IEEE 1800-2023, used by Helix/Neovim/Emacs

**WASM Reality Check**: **Neither parser ships prebuilt WASM.** You must build it yourself. Modern tree-sitter CLI uses WASI SDK (auto-downloaded) - Docker/Emscripten are legacy options.

---

## Project Structure

```
fsm_viz/
├── package.json
├── tsconfig.json
├── vite.config.ts               # Web build - WASM plugin config
├── esbuild.cli.mjs              # CLI build - Node.js bundling
├── .github/
│   └── workflows/
│       └── ci.yml               # Build + test on PR (see CI section below)
├── src/
│   ├── index.ts                 # Main library export
│   ├── parser/
│   │   ├── tree-sitter-init.ts  # WASM/native initialization (~100 lines)
│   │   ├── ast-walker.ts        # Tree traversal utilities
│   │   └── queries.ts           # Tree-sitter query definitions
│   ├── extractor/
│   │   ├── enum-detector.ts     # typedef enum state detection
│   │   ├── register-detector.ts # State register identification
│   │   ├── always-analyzer.ts   # always_ff/always_comb parsing
│   │   ├── transition-builder.ts# State transition extraction
│   │   ├── output-extractor.ts  # Moore/Mealy output extraction
│   │   ├── condition-simplifier.ts # Nested if/else → flat conditions
│   │   └── multi-fsm-detector.ts # Multiple FSMs per module
│   ├── validator/
│   │   ├── reachability.ts      # Unreachable/terminal state detection
│   │   └── coverage.ts          # Missing case coverage check
│   ├── generator/
│   │   └── mermaid.ts           # Mermaid stateDiagram output
│   ├── errors.ts                # User-friendly error messages
│   └── types.ts                 # Shared type definitions
├── cli/
│   └── index.ts                 # CLI entry point
├── web/
│   ├── index.html
│   ├── fsm-viz.ts
│   └── style.css
├── public/
│   ├── tree-sitter.wasm         # Copied via postinstall
│   └── tree-sitter-systemverilog.wasm
├── scripts/
│   └── build-wasm.sh            # WASM build automation
└── tests/
    ├── fixtures/                # Sample SV files (need 50+ real examples)
    ├── corpus/                  # Real-world FSMs for coverage testing
    └── *.test.ts
```

---

## Core Data Structures

```typescript
// Output signal assignment (Moore or Mealy)
interface FSMOutput {
  signal: string;             // e.g., "enable"
  value: string;              // e.g., "1'b1"
  line: number;
}

interface FSMState {
  name: string;
  encoding?: string;          // e.g., "2'b00"
  line: number;
  isDefault?: boolean;
  outputs: FSMOutput[];       // Moore outputs: depend only on state
  comment?: string;           // Extracted from nearby comments
  isUnreachable?: boolean;    // No incoming transitions (except reset)
  isTerminal?: boolean;       // No outgoing transitions
}

interface FSMTransition {
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

interface FSM {
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
    outputExtraction: number;   // NEW: How well we captured outputs
  };
  warnings: FSMWarning[];       // Structured warnings
  errors: string[];             // Non-fatal parse issues
  inputSignals: string[];       // Signals that appear in conditions
  outputSignals: string[];      // Signals assigned in states/transitions
}

// Structured warnings for validation
interface FSMWarning {
  type: 'unreachable_state' | 'terminal_state' | 'missing_case' |
        'no_reset' | 'implicit_default';
  message: string;
  line?: number;
  states?: string[];            // Affected states
}

// What we can detect vs what we infer
interface DetectionMetadata {
  statesExplicit: boolean;      // Found typedef enum vs inferred
  transitionsComplete: boolean; // All branches covered vs gaps
  hasImplicitSelfLoops: boolean;// Default assignment pattern detected
  hasMooreOutputs: boolean;     // Found state-dependent outputs
  hasMealyOutputs: boolean;     // Found transition-dependent outputs
}

// Support for multiple FSMs per module
interface ModuleAnalysis {
  moduleName: string;
  fsms: FSM[];                  // Can have multiple FSMs
  parseErrors: string[];
}
```

---

## Extraction Algorithm

### Step 1: Parse to AST
```typescript
const tree = parser.parse(source);  // tree-sitter-systemverilog
```

### Step 2: Find State Type Definitions
- Look for: `typedef enum logic [N:0] { STATE1, STATE2, ... } state_t;`
- Extract state names and optional encodings

**Patterns we handle:**
```systemverilog
typedef enum logic [1:0] { IDLE, RUN, DONE } state_t;           // Basic
typedef enum logic [1:0] { IDLE=2'b00, RUN=2'b01 } state_t;     // Explicit encoding
enum { IDLE, RUN, DONE } state;                                  // Direct (no typedef)
```

**Patterns we DON'T handle (see Known Limitations):**
```systemverilog
localparam IDLE = 2'b00, RUN = 2'b01;    // ~10% of FSMs use this
import my_pkg::state_t;                   // Package imports
typedef enum logic [WIDTH-1:0] {...};     // Parameterized width
```

### Step 3: Find State Registers
- Look for: `state_t state, next_state;`
- Heuristics: variable names containing "state", "fsm", "cs", "ns", "ps", "cstate", "nstate"

**Disambiguation needed:** Variables like `state_machine_enable` or `fsm_counter` should NOT match.

### Step 4: Analyze Always Blocks
- Identify `always_ff` (sequential) vs `always_comb` (combinational) vs `always @(*)` (legacy)
- Find which blocks touch state registers
- Locate case statements on state variable
- Detect block style: one-block, two-block, or three-block FSM

**Block styles we handle:**
```systemverilog
// Two-block (most common, ~40%)
always_ff @(posedge clk) state <= next_state;
always_comb case (state) ...

// One-block (legacy, ~15%)
always @(posedge clk) case (state) IDLE: if (go) state <= RUN; ...

// Three-block (Cliff Cummings style, ~25%)
always_ff @(posedge clk) state <= next_state;
always_comb next_state = ...;
always_comb output = ...;  // We ignore this block
```

### Step 5: Extract Transitions (THE HARD PART)

This is the most complex step. Break into sub-steps:

#### 5a: Simple if extraction
```systemverilog
IDLE: if (start) next_state = RUN;
// → Transition(IDLE → RUN, condition="start")
```

#### 5b: Nested if/else with condition inversion
```systemverilog
IDLE: begin
    if (a) next_state = RUN;
    else if (b) next_state = DONE;
    else next_state = IDLE;
end
// → Transition(IDLE → RUN, condition="a")
// → Transition(IDLE → DONE, condition="!a && b")
// → Transition(IDLE → IDLE, condition="!a && !b")  // Self-loop
```

**Challenge:** Condition simplification is non-trivial. We may emit unsimplified conditions.

#### 5c: Default assignment inference
```systemverilog
always_comb begin
    next_state = state;  // DEFAULT: stay in current state
    case (state)
        IDLE: if (go) next_state = RUN;
        // Implicit: else stay in IDLE (from default)
    endcase
end
```

Must detect `next_state = state` pattern and infer self-loops for all states.

#### 5d: Multiple assignments in one branch (last write wins)
```systemverilog
IDLE: begin
    next_state = RUN;
    if (urgent) next_state = FAST;  // Overwrites!
end
// → Transition(IDLE → FAST, condition="urgent")
// → Transition(IDLE → RUN, condition="!urgent")
```

#### 5e: casez/casex wildcards
```systemverilog
casez (state)
    3'b1??: next_state = IDLE;  // Matches multiple states!
endcase
```

**We punt on this.** Emit warning, treat as unknown.

### Step 6: Infer Reset State

**Reset patterns to detect:**
```systemverilog
// Active-low async reset (most common)
always_ff @(posedge clk or negedge rst_n)
    if (!rst_n) state <= IDLE;        // Pattern 1: !rst_n

// Active-high sync reset
always_ff @(posedge clk)
    if (rst) state <= IDLE;           // Pattern 2: rst (no negation)

// Alternative syntax variations
if (~reset_n) state <= IDLE;          // Pattern 3: ~ operator
if (reset == 1'b0) state <= IDLE;     // Pattern 4: explicit comparison
if (rst === 1'b1) state <= IDLE;      // Pattern 5: 4-state comparison
```

**Detection strategy:**
1. Look in sensitivity list for `negedge rst_n` / `posedge rst` (async reset indicator)
2. Find the first `if` inside always_ff that assigns to state register
3. Check if condition contains reset-like signal name
4. Fallback: first state in enum definition

### Step 7: Extract Outputs (Moore and Mealy)

Any assignment that is NOT to `next_state`/`state` is a potential output.

**Moore outputs** (depend only on state - unconditional in case item):
```systemverilog
IDLE: begin
    ready = 1'b1;              // Moore: always 1 in IDLE → goes in state bubble
    enable = 1'b0;             // Moore: always 0 in IDLE
    if (start) next_state = RUN;
end
```
→ `IDLE.outputs = [{signal: "ready", value: "1'b1"}, {signal: "enable", value: "1'b0"}]`

**Mealy outputs** (depend on state AND inputs - inside conditional):
```systemverilog
IDLE: begin
    if (start) begin
        ack = 1'b1;            // Mealy: only during IDLE→RUN transition
        next_state = RUN;
    end
end
```
→ `Transition(IDLE→RUN).outputs = [{signal: "ack", value: "1'b1"}]`

**Heuristic for identifying outputs:**
- Assignments to signals that are NOT the state register
- Signals assigned in multiple states are likely outputs
- Signals only assigned once might be internal (lower confidence)

### Step 8: Detect Multiple FSMs

A module may contain multiple independent FSMs:
```systemverilog
typedef enum { TX_IDLE, TX_SEND, TX_DONE } tx_state_t;
typedef enum { RX_IDLE, RX_RECV, RX_DONE } rx_state_t;

tx_state_t tx_state, tx_next;
rx_state_t rx_state, rx_next;
```

**Detection strategy:**
1. Find all typedef enums that look like state definitions
2. Find all state register pairs
3. Match enums to registers by type
4. Create separate FSM objects for each
5. Name FSMs by their type name (e.g., "tx_state_t", "rx_state_t")

### Step 9: Validate FSM

Run validation checks and populate warnings:

**Unreachable states:**
```typescript
// States with no incoming transitions (except reset state)
for (const state of fsm.states) {
  const hasIncoming = fsm.transitions.some(t => t.to === state.name);
  const isReset = state.name === fsm.resetState;
  if (!hasIncoming && !isReset) {
    state.isUnreachable = true;
    fsm.warnings.push({ type: 'unreachable_state', states: [state.name] });
  }
}
```

**Terminal states (no exit):**
```typescript
// States with no outgoing transitions - might be intentional (DONE state)
for (const state of fsm.states) {
  const hasOutgoing = fsm.transitions.some(t => t.from === state.name && !t.isSelfLoop);
  if (!hasOutgoing) {
    state.isTerminal = true;
    fsm.warnings.push({ type: 'terminal_state', states: [state.name] });
  }
}
```

**Missing case coverage:**
```typescript
// Enum values not handled in case statement
const handledStates = new Set(caseItems.map(c => c.label));
for (const state of fsm.states) {
  if (!handledStates.has(state.name)) {
    fsm.warnings.push({ type: 'missing_case', states: [state.name] });
  }
}
```

**No reset state detected:**
```typescript
// Warn if we couldn't find a reset state
if (!fsm.resetState) {
  fsm.warnings.push({
    type: 'no_reset',
    message: 'No reset state detected. Diagram will not show initial state arrow.'
  });
}
```

**Implicit default (self-loop inferred):**
```typescript
// Warn when self-loops were inferred from default assignment pattern
// detectionMetadata is populated during extraction (Step 5c) when we detect
// the `next_state = state` default assignment pattern
function validateImplicitDefaults(fsm: FSM, metadata: DetectionMetadata): void {
  if (metadata.hasImplicitSelfLoops) {
    const implicitStates = fsm.transitions
      .filter(t => t.isImplicit && t.isSelfLoop)
      .map(t => t.from);
    if (implicitStates.length > 0) {
      fsm.warnings.push({
        type: 'implicit_default',
        message: 'Self-loops inferred from default assignment pattern',
        states: [...new Set(implicitStates)]
      });
    }
  }
}
```

---

## CLI Interface

```
fsm_viz extract <file.sv> [options]

Options:
  -o, --output <file>     Output file (default: stdout)
  -f, --format <format>   mermaid | json (default: mermaid)
  -d, --direction <dir>   TB | LR (default: TB)
  -c, --conditions        Include transition conditions
  -p, --outputs           Include Moore/Mealy outputs
  -w, --warnings          Show validation warnings
  -m, --module <name>     Extract specific module only
  --fsm <name>            Extract specific FSM (if multiple per module)
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
    ready = 1'b0;              // Default
    enable = 1'b0;
    ack = 1'b0;

    case (state)
        IDLE: begin
            ready = 1'b1;      // Moore output: always ready in IDLE
            if (start) begin
                ack = 1'b1;    // Mealy output: ack on start
                next_state = RUN;
            end
        end
        RUN: begin
            enable = 1'b1;     // Moore output: enable during RUN
            if (done) next_state = DONE;
        end
        DONE: next_state = IDLE;
    endcase
end
```

### Output (Mermaid) - Basic
```
stateDiagram-v2
    direction LR
    [*] --> IDLE
    IDLE --> RUN: start
    RUN --> DONE: done
    DONE --> IDLE
```

### Output (Mermaid) - With Outputs (`-p` flag)
```
stateDiagram-v2
    direction LR
    [*] --> IDLE

    IDLE: IDLE
    IDLE: ready=1
    RUN: RUN
    RUN: enable=1
    DONE: DONE

    IDLE --> RUN: start / ack=1
    RUN --> DONE: done
    DONE --> IDLE
```

The `condition / output` notation on arrows is standard FSM syntax for Mealy outputs.

---

## Scope

### In Scope (v1)
- `typedef enum` state definitions
- `always_ff` / `always_comb` / `always @(*)` blocks
- One-block, two-block, and three-block FSM styles
- `case` / `casez` / `casex` statements
- `if-else` transition conditions (with basic simplification)
- Reset state detection
- **Moore output extraction** (state-dependent outputs in bubbles)
- **Mealy output extraction** (transition-dependent outputs on arrows)
- **Multiple FSMs per module** detection
- **Validation warnings** (unreachable states, terminal states, missing coverage)
- **Click-to-source** in web UI (line number linking)
- Mermaid + JSON output
- CLI + Web interfaces

### Out of Scope (v1)
- VHDL
- Hierarchical FSMs
- FSMs split across files
- Visual editor (diagram → code)
- Synthesis attributes
- DOT/Graphviz output (Mermaid only for v1)
- Non-determinism detection (overlapping conditions)

---

## Known Limitations

**These patterns will NOT work. This is by design for v1.**

### FSM Patterns We Don't Support (~40% of real FSMs - ESTIMATE)

**Note**: The percentages below are rough estimates, not research-backed. Actual prevalence may vary significantly. Notably, `localparam` states are considered **best practice** by some style guides, so the 10% estimate may be conservative.

| Pattern | Est. Prevalence | Why Not Supported |
|---------|-----------------|-------------------|
| `localparam` states | ~10-25%? | Requires dataflow analysis to link values to case labels. **May be underestimated - this is recommended style.** |
| Package-imported states | ~5% | Multi-file analysis out of scope |
| Parameterized enums | ~5% | `[$clog2(N)-1:0]` requires elaboration |
| Hierarchical FSMs | ~5% | Sub-FSM calls need call graph analysis |
| `unique case` / `priority case` | ~5% | Semantics affect implicit default; punted |
| Single-file includes | ~5% | No preprocessor |
| State arrays `state[N]` | ~2% | Multiple FSM instances |
| Assertions in FSM | ~3% | `assert`/`assume` mixed with logic |

### Syntax That Will Cause Parse Failures

```systemverilog
`include "states.vh"          // Preprocessor not supported
`define NEXT(s) next_state=s  // Macros not expanded
```

### Edge Cases We Handle Poorly

1. **Deeply nested if/else**: Conditions get ugly (`!a && !b && c || d`)
2. **casez with wildcards on state variable**: We emit a warning and skip
3. **Mixed blocking/non-blocking in same block**: Undefined behavior
4. **FSMs without explicit reset**: No initial state arrow in diagram

### Confidence Scoring

We report confidence 0-1 based on:
- **1.0**: Found typedef enum, clear two-block structure, all transitions explicit
- **0.7-0.9**: Some inference needed (implicit self-loops, reset guessed)
- **0.5-0.7**: Significant inference (one-block style, heuristic variable detection)
- **<0.5**: Likely wrong (couldn't find states, guessing at structure)

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
← Monospace textarea with line numbers

Direction: [Top to Bottom ▼]  ☑ Show Conditions  ☑ Show Outputs

[Extract FSM]  [Reset]

FSM: [All FSMs ▼]   ← Dropdown if multiple FSMs detected
```

### Results Section
```
## Results

┌─ Diagram ─────────────────────────┐
│                                   │
│    [Rendered Mermaid SVG]         │
│    Click state/transition to      │
│    highlight source line          │
│                                   │
└───────────────────────────────────┘

## Warnings                    [Hide]
⚠ UNREACHABLE: State 'ERROR' has no incoming transitions
⚠ TERMINAL: State 'DONE' has no outgoing transitions

## Mermaid Code                [Copy]
┌─────────────────────────────────────┐
│ stateDiagram-v2                     │
│     [*] --> IDLE                    │
│     IDLE --> RUN: start / ack=1    │
└─────────────────────────────────────┘
← Monospace, selectable
```

### Click-to-Source Behavior

When user clicks on a state or transition in the diagram:
1. Highlight the corresponding line(s) in the source textarea
2. Scroll source to show the highlighted line
3. Show tooltip with line number and extracted info

Implementation:
- Mermaid supports click handlers via `click` callback
- Store line numbers in FSM data structures
- Map diagram elements to source locations

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

## WASM Bundling Complexity

**This is harder than it looks.** The plan originally understated this significantly.

### The Problem

1. **No prebuilt WASM exists** for tree-sitter-systemverilog
2. **web-tree-sitter requires specific bundler config** that isn't obvious
3. **Vite dev server has known issues** with WASM in node_modules

### What's Actually Required

#### 1. Build the WASM

Modern tree-sitter CLI (v0.24+) **prefers WASI SDK** which it auto-downloads (~40MB) to `~/.cache/tree-sitter/`. Falls back to Docker or Emscripten if WASI SDK fails. No manual setup needed in most cases.

```bash
#!/bin/bash
# scripts/build-wasm.sh
set -e  # Exit on any error

echo "=== Building tree-sitter WASM ==="

# Check prerequisites
if ! command -v npx &> /dev/null; then
    echo "ERROR: npx not found. Install Node.js first."
    exit 1
fi

# Ensure tree-sitter-cli is available
npx tree-sitter --version || {
    echo "ERROR: tree-sitter-cli not working"
    exit 1
}

# Build the WASM (modern syntax: build --wasm, not build-wasm)
# First run will auto-download WASI SDK (~40MB) to ~/.cache/tree-sitter/
echo "Building WASM (first run downloads WASI SDK)..."
npx tree-sitter build --wasm node_modules/tree-sitter-systemverilog

# Verify output exists
if [ ! -f "tree-sitter-systemverilog.wasm" ]; then
    echo "ERROR: WASM build produced no output"
    exit 1
fi

# Copy to public directory (for web) and dist directory (for CLI)
mkdir -p public dist
cp tree-sitter-systemverilog.wasm public/
cp tree-sitter-systemverilog.wasm dist/
cp node_modules/web-tree-sitter/tree-sitter.wasm public/
cp node_modules/web-tree-sitter/tree-sitter.wasm dist/

echo "=== WASM build successful ==="
echo "Files created:"
ls -la public/*.wasm dist/*.wasm
```

**Note**: The `build-wasm` subcommand is deprecated. Use `build --wasm` instead.

#### 2. Vite Configuration

**CRITICAL**: Vite 6.0.7+ breaks `vite-plugin-top-level-await`. Pin to 6.0.6 or remove the plugin and rely on `target: 'esnext'`.

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ['web-tree-sitter']  // Prevent prebundling issues (Vite bug workaround)
  },
  build: {
    target: 'esnext'  // Required for top-level await
  }
});
```

**Vite version bug**: See [GitHub Issue #19160](https://github.com/vitejs/vite/issues/19160). Either:
1. Pin `"vite": "6.0.6"` (not `^6.0.0`)
2. Or remove `vite-plugin-top-level-await` and rely solely on `target: 'esnext'`

#### 3. Parser Initialization (Platform-Specific)

```typescript
// src/parser/tree-sitter-init.ts
import Parser from 'web-tree-sitter';

// CORRECT: Check for browser vs Node.js (NOT import.meta.env which is Vite-specific)
const isBrowser = typeof window !== 'undefined';

export async function initParser(): Promise<Parser> {
  if (isBrowser) {
    // Browser: use locateFile to find WASM files via HTTP fetch
    await Parser.init({
      // Full signature: locateFile(scriptName: string, scriptDirectory: string): string
      locateFile(scriptName: string, _scriptDirectory: string) {
        // Vite dev server serves from root, production from assets
        return `/${scriptName}`;
      },
    });

    const parser = new Parser();
    // Browser: This triggers an HTTP fetch to the URL
    const lang = await Parser.Language.load('/tree-sitter-systemverilog.wasm');
    parser.setLanguage(lang);
    return parser;
  } else {
    // Node.js: load WASM from filesystem (reads file, not HTTP)
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    await Parser.init();
    const parser = new Parser();

    // After esbuild bundles to dist/cli.mjs, WASM files are in dist/ alongside it
    // The build-wasm.sh script copies WASM to both public/ and dist/
    const wasmPath = path.join(__dirname, 'tree-sitter-systemverilog.wasm');
    const lang = await Parser.Language.load(wasmPath);
    parser.setLanguage(lang);
    return parser;
  }
}
```

**Important notes**:
- Browser `Parser.Language.load()` fetches via HTTP; Node.js reads from filesystem
- The path `__dirname` points to `dist/` after bundling, so WASM must be copied there
- Uses `import.meta.url` which requires ESM (`"type": "module"` in package.json)

#### 4. package.json Scripts

```json
{
  "scripts": {
    "postinstall": "npm run build:wasm",
    "build:wasm": "bash scripts/build-wasm.sh"
  }
}
```

### Known Issues

- **Vite Issue #19962**: WASM fails in dev mode if prebundled. Use `optimizeDeps.exclude`. This is a workaround for a known bug.
- **locateFile confusion**: Path differs between dev server and production build.
- **fs polyfill**: web-tree-sitter imports Node's `fs`; bundlers may warn.
- **Emscripten version**: tree-sitter has known compatibility issues with some Emscripten versions.

### Alternative: vite-plugin-tree-sitter

Consider using [vite-plugin-tree-sitter](https://jsr.io/@guyven/vite-plugin-tree-sitter) (v0.2.8, Jan 2025) which handles:
- Grammar compilation during Vite lifecycle
- Automatic WASM serving in dev mode
- Production bundle inclusion

**Note**: This is published on JSR (Deno's registry), not npm. Install via:
```bash
npx jsr add @guyven/vite-plugin-tree-sitter
```

This could eliminate most manual WASM configuration. Evaluate during spike.

### esbuild CLI Configuration

```javascript
// esbuild.cli.mjs
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';

// Ensure dist directory exists
mkdirSync('dist', { recursive: true });

await esbuild.build({
  entryPoints: ['cli/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',  // Match engines.node requirement
  format: 'esm',
  outfile: 'dist/cli.mjs',
  external: ['web-tree-sitter'],  // Loaded at runtime, not bundled
  banner: {
    js: '#!/usr/bin/env node',
  },
});

// Copy WASM files to dist/ so CLI can find them at runtime
// (build-wasm.sh also does this, but this ensures it happens on every build)
try {
  copyFileSync('public/tree-sitter.wasm', 'dist/tree-sitter.wasm');
  copyFileSync('public/tree-sitter-systemverilog.wasm', 'dist/tree-sitter-systemverilog.wasm');
  console.log('WASM files copied to dist/');
} catch (e) {
  console.warn('Warning: Could not copy WASM files. Run build:wasm first.');
}
```

**Why external web-tree-sitter?** The package loads WASM at runtime and has Node.js-specific code paths. Bundling it causes issues.

### Recommendation

**Do a WASM bundling spike FIRST** before writing any extraction logic. Verify:
1. Vite dev server works
2. Production build works
3. Both tree-sitter.wasm AND tree-sitter-systemverilog.wasm load correctly
4. CLI can load WASM from filesystem in Node.js

---

## Implementation Order

### Phase 0: Validation Spikes (Do These First!)

0. **Parser Evaluation Spike**
   - Install tree-sitter-systemverilog
   - Parse a sample FSM, dump AST to discover actual node type names
   - **Expected node types** (verify these!):
     - `type_declaration` (NOT `enum_declaration`)
     - `always_construct` (NOT `always_block`)
     - `case_statement` (this one is probably correct)
     - `enum_name_declaration` (for individual enum members)
   - **Critical insight**: `always_construct` does NOT distinguish `always_ff` vs `always_comb` vs `always @(*)` as separate node types. All are `always_construct` with an `always_keyword` child node that contains the actual keyword text. Extractor must parse the child to determine block type.
   - **Exit criteria**: Can walk AST and find case statements
   - **Critical**: Document actual node types found - all extractor code depends on this

1. **WASM Bundling Spike**
   - Set up Vite with vite-plugin-wasm
   - Build WASM from tree-sitter-systemverilog
   - Verify dev server AND production build work
   - **Exit criteria**: Browser console shows "Parser initialized" with no errors

### Phase 1: Core Extraction

2. **Project Setup** - TypeScript, Vitest, eslint, basic types
3. **Enum Detector** - Find typedef enum states, extract names/encodings
4. **Register Detector** - Find state/next_state variables with heuristics
5. **Always Analyzer** - Parse always blocks, detect block style, find case statements

### Phase 2: Transition Extraction (The Hard Part)

6. **Transition Builder - Simple Cases**
   - 6a: Direct assignments in case items
   - 6b: Simple if statements
   - **Exit criteria**: Example from plan works

7. **Transition Builder - Complex Cases**
   - 7a: Nested if/else with condition accumulation
   - 7b: Default assignment inference (self-loops)
   - 7c: Multiple assignments (last write wins)
   - **Exit criteria**: 3+ real-world FSMs work

### Phase 3: Output Extraction & Multi-FSM

8. **Output Extractor**
   - 8a: Moore outputs (unconditional assignments in case items)
   - 8b: Mealy outputs (assignments inside conditionals with transitions)
   - 8c: Track input/output signal lists
   - **Exit criteria**: Example with ready/enable/ack works

9. **Multi-FSM Detector**
   - 9a: Find all typedef enums that look like state types
   - 9b: Match enums to register variables
   - 9c: Create separate FSM objects
   - **Exit criteria**: Module with tx_state/rx_state produces two FSMs

### Phase 4: Validation

10. **Validator - Reachability**
    - Detect unreachable states (no incoming transitions)
    - Detect terminal states (no outgoing transitions)
    - **Exit criteria**: Warnings appear for orphan states

11. **Validator - Coverage**
    - Detect enum values not handled in case
    - Warn about missing default case
    - **Exit criteria**: Missing case items flagged

### Phase 5: Output & Integration

12. **Mermaid Generator**
    - Basic state diagram
    - Moore outputs in state labels
    - Mealy outputs on transition labels (condition / output)
    - **Exit criteria**: Both Mermaid output variants work

13. **CLI** - File I/O, Commander.js wrapper, warning display

14. **Web UI**
    - Match bitwiz.io/calc theme
    - FSM selector dropdown (for multi-FSM)
    - Click-to-source highlighting
    - Warning display panel
    - **Exit criteria**: Can click state to highlight source line

### Phase 6: Hardening

15. **Test Corpus** - Collect 50+ real FSMs from open source, measure actual coverage
    - Sources: [cv32e40p](https://github.com/openhwgroup/cv32e40p), [picorv32](https://github.com/YosysHQ/picorv32), [verilog-ethernet](https://github.com/alexforencich/verilog-ethernet)
    - Challenge: Many will use `include` which we don't support - filter these out
16. **Error Handling** - User-friendly messages with line numbers
17. **Polish** - Edge cases, warnings, confidence scoring

### Dependencies to Install

```json
{
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "web-tree-sitter": "^0.24.0",
    "commander": "^12.0.0",
    "mermaid": "^11.0.0"
  },
  "devDependencies": {
    "tree-sitter-cli": "^0.24.0",
    "tree-sitter-systemverilog": "github:gmlarumbe/tree-sitter-systemverilog",
    "typescript": "^5.0.0",
    "vite": "6.0.6",
    "vite-plugin-wasm": "^3.0.0",
    "vite-plugin-top-level-await": "^1.4.0",
    "vitest": "^4.0.0",
    "esbuild": "~0.24.0"
  }
}
```

**Important version notes**:
- `"engines": {"node": ">=20.0.0"}` required - Vitest 4.x needs Node 20+
- `"type": "module"` required for ESM and `import.meta.url` in CLI
- `"vite": "6.0.6"` pinned exactly (NOT `^6.0.0`) due to bug in 6.0.7+ breaking vite-plugin-top-level-await
- `"vitest": "^4.0.0"` - use current major version (2.x is outdated)
- `"esbuild": "~0.24.0"` - use tilde (not caret) to avoid 0.25+ breaking changes
- Keep `tree-sitter-cli` and `web-tree-sitter` versions aligned (both 0.24.x) for WASM compatibility
- `tree-sitter-systemverilog` is **GitHub-only** (not published to npm) - this is intentional
- `@types/web-tree-sitter` doesn't exist - web-tree-sitter ships its own TypeScript definitions

---

## CI/CD Configuration

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      # WASM build happens automatically via postinstall
      # tree-sitter CLI will auto-download WASI SDK on first run

      - name: Type check
        run: npx tsc --noEmit

      - name: Run tests
        run: npm test

      - name: Build CLI
        run: node esbuild.cli.mjs

      - name: Build Web
        run: npm run build

      - name: Verify WASM files exist
        run: |
          test -f public/tree-sitter.wasm
          test -f public/tree-sitter-systemverilog.wasm
          test -f dist/tree-sitter-systemverilog.wasm
```

**Notes**:
- WASI SDK auto-downloads to `~/.cache/tree-sitter/` on first `tree-sitter build --wasm` run
- GitHub Actions has enough disk space for this (~40MB)
- If builds are slow, consider caching `~/.cache/tree-sitter/`

---

## Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Parser | tree-sitter-systemverilog (gmlarumbe) | IEEE 1800-2023, ~3000 tests, actively maintained |
| Parser (rejected) | tree-sitter-verilog | Only 54 tests, no prebuilt WASM, 2+ years stale |
| Output | Mermaid (not Graphviz) | User-portable, renders anywhere |
| Scope | 50-60% patterns (honest) | Ship fast, be transparent about limitations |
| Architecture | Shared core | One codebase for CLI + web (with platform-specific init) |
| Condition simplification | Basic only | Full boolean simplification is out of scope |
| localparam states | Not supported | Would require dataflow analysis; v2 maybe |

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WASM bundling fails in Vite | Medium | High | Do spike first; have fallback to esbuild |
| tree-sitter-systemverilog missing node types | Low | High | Spike will reveal; can contribute upstream |
| Condition extraction too complex | High | Medium | Start simple, emit raw conditions if simplification fails |
| Real coverage is <50% | Medium | Medium | Be honest in UI; collect user feedback on failing patterns |
| Users paste code with `` `include `` | High | Low | Clear error message explaining limitation |
