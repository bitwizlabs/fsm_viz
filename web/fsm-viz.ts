import mermaid from 'mermaid';
import { extractFSMs, generateMermaid, generateValidationSummary } from '../src/index.js';
import type { FSM, MermaidOptions, ModuleAnalysis } from '../src/types.js';

// DOM elements
const sourceInput = document.getElementById('sourceInput') as HTMLTextAreaElement;
const lineNumbers = document.getElementById('lineNumbers') as HTMLDivElement;
const directionSelect = document.getElementById('direction') as HTMLSelectElement;
const showConditionsCheck = document.getElementById('showConditions') as HTMLInputElement;
const showOutputsCheck = document.getElementById('showOutputs') as HTMLInputElement;
const fsmSelectorGroup = document.getElementById('fsmSelectorGroup') as HTMLDivElement;
const fsmSelector = document.getElementById('fsmSelector') as HTMLSelectElement;
const extractBtn = document.getElementById('extractBtn') as HTMLButtonElement;
const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
const outputSection = document.getElementById('outputSection') as HTMLElement;
const diagramOutput = document.getElementById('diagramOutput') as HTMLDivElement;
const warningsContainer = document.getElementById('warningsContainer') as HTMLDivElement;
const warningsList = document.getElementById('warningsList') as HTMLDivElement;
const toggleWarningsBtn = document.getElementById('toggleWarnings') as HTMLButtonElement;
const mermaidOutput = document.getElementById('mermaidOutput') as HTMLPreElement;
const copyMermaidBtn = document.getElementById('copyMermaid') as HTMLButtonElement;
const statsOutput = document.getElementById('statsOutput') as HTMLDivElement;
const toast = document.getElementById('toast') as HTMLDivElement;

// State
let currentAnalysis: ModuleAnalysis | null = null;
let selectedFSM: FSM | null = null;

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

// Line numbers
function updateLineNumbers(): void {
  const lines = sourceInput.value.split('\n');
  lineNumbers.innerHTML = lines
    .map((_, i) => `<div>${i + 1}</div>`)
    .join('');
}

sourceInput.addEventListener('input', updateLineNumbers);
sourceInput.addEventListener('scroll', () => {
  lineNumbers.scrollTop = sourceInput.scrollTop;
});

// Initial line numbers
updateLineNumbers();

// Extract FSM
extractBtn.addEventListener('click', async () => {
  const source = sourceInput.value.trim();

  if (!source) {
    showToast('Please enter SystemVerilog code', true);
    return;
  }

  extractBtn.disabled = true;
  extractBtn.textContent = 'Extracting...';

  try {
    currentAnalysis = await extractFSMs(source);

    if (currentAnalysis.fsms.length === 0) {
      showToast('No FSM detected in the code', true);
      return;
    }

    // Update FSM selector if multiple FSMs
    if (currentAnalysis.fsms.length > 1) {
      fsmSelectorGroup.style.display = 'block';
      fsmSelector.innerHTML = currentAnalysis.fsms
        .map((fsm, i) => `<option value="${i}">${fsm.name}</option>`)
        .join('');
    } else {
      fsmSelectorGroup.style.display = 'none';
    }

    // Select first FSM
    selectedFSM = currentAnalysis.fsms[0];

    // Render
    await renderOutput();

    outputSection.style.display = 'block';
    showToast('FSM extracted successfully');
  } catch (error) {
    showToast(`Error: ${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    extractBtn.disabled = false;
    extractBtn.textContent = 'Extract FSM';
  }
});

// FSM selector change
fsmSelector.addEventListener('change', async () => {
  if (currentAnalysis) {
    const index = parseInt(fsmSelector.value, 10);
    selectedFSM = currentAnalysis.fsms[index];
    await renderOutput();
  }
});

// Options change
directionSelect.addEventListener('change', renderOutput);
showConditionsCheck.addEventListener('change', renderOutput);
showOutputsCheck.addEventListener('change', renderOutput);

// Render output
async function renderOutput(): Promise<void> {
  if (!selectedFSM) return;

  const options: MermaidOptions = {
    direction: directionSelect.value as 'TB' | 'LR',
    showConditions: showConditionsCheck.checked,
    showOutputs: showOutputsCheck.checked,
    showSelfLoops: true,
  };

  // Generate Mermaid code
  const mermaidCode = generateMermaid(selectedFSM, options);
  mermaidOutput.textContent = mermaidCode;

  // Render diagram
  try {
    const { svg } = await mermaid.render('fsm-diagram', mermaidCode);
    diagramOutput.innerHTML = svg;

    // Add click handlers to states
    addStateClickHandlers();
  } catch (error) {
    diagramOutput.innerHTML = `<p style="color: red;">Failed to render diagram: ${error}</p>`;
  }

  // Render warnings
  if (selectedFSM.warnings.length > 0) {
    warningsContainer.style.display = 'block';
    warningsList.innerHTML = selectedFSM.warnings
      .map((w) => `<div class="warning-item">${w.message}</div>`)
      .join('');
  } else {
    warningsContainer.style.display = 'none';
  }

  // Render stats
  const summary = generateValidationSummary(selectedFSM);
  statsOutput.innerHTML = `
    <div class="stat-item">
      <div class="stat-value">${summary.stats.stateCount}</div>
      <div class="stat-label">States</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${summary.stats.transitionCount}</div>
      <div class="stat-label">Transitions</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${selectedFSM.resetState || 'N/A'}</div>
      <div class="stat-label">Reset State</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${(selectedFSM.confidence * 100).toFixed(0)}%</div>
      <div class="stat-label">Confidence</div>
    </div>
  `;
}

// Add click handlers to state nodes
function addStateClickHandlers(): void {
  if (!selectedFSM) return;

  const svg = diagramOutput.querySelector('svg');
  if (!svg) return;

  // Find state nodes (g elements with class "node")
  const stateNodes = svg.querySelectorAll('g.node');

  stateNodes.forEach((node) => {
    (node as HTMLElement).style.cursor = 'pointer';
    node.addEventListener('click', (e) => {
      const text = node.querySelector('text')?.textContent;
      if (text && selectedFSM) {
        const state = selectedFSM.states.find((s) => s.name === text);
        if (state) {
          highlightSourceLine(state.line);
        }
      }
    });
  });
}

// Highlight source line
function highlightSourceLine(line: number): void {
  const lines = sourceInput.value.split('\n');
  const lineStart = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
  const lineEnd = lineStart + lines[line - 1].length;

  sourceInput.focus();
  sourceInput.setSelectionRange(lineStart, lineEnd);

  // Scroll to line
  const lineHeight = sourceInput.scrollHeight / lines.length;
  sourceInput.scrollTop = (line - 5) * lineHeight;

  showToast(`Line ${line}`);
}

// Toggle warnings
toggleWarningsBtn.addEventListener('click', () => {
  const list = warningsList;
  if (list.style.display === 'none') {
    list.style.display = 'block';
    toggleWarningsBtn.textContent = 'Hide';
  } else {
    list.style.display = 'none';
    toggleWarningsBtn.textContent = 'Show';
  }
});

// Copy Mermaid
copyMermaidBtn.addEventListener('click', async () => {
  const text = mermaidOutput.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  } catch {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Copied to clipboard');
  }
});

// Reset
resetBtn.addEventListener('click', () => {
  sourceInput.value = '';
  updateLineNumbers();
  outputSection.style.display = 'none';
  currentAnalysis = null;
  selectedFSM = null;
  fsmSelectorGroup.style.display = 'none';
});

// Toast notification
function showToast(message: string, isError = false): void {
  toast.textContent = message;
  toast.className = `toast show ${isError ? 'error' : ''}`;

  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

// Load example on page load if empty
if (!sourceInput.value) {
  sourceInput.value = `// Example FSM - Traffic Light Controller
typedef enum logic [1:0] {
    RED,
    GREEN,
    YELLOW
} light_state_t;

light_state_t state, next_state;

always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)
        state <= RED;
    else
        state <= next_state;
end

always_comb begin
    next_state = state;
    case (state)
        RED:    if (timer_done) next_state = GREEN;
        GREEN:  if (timer_done) next_state = YELLOW;
        YELLOW: if (timer_done) next_state = RED;
    endcase
end`;
  updateLineNumbers();
}
