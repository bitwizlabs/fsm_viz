import { Parser, Language } from 'web-tree-sitter';

// Check for browser vs Node.js (NOT import.meta.env which is Vite-specific)
const isBrowser = typeof window !== 'undefined';

let parserInstance: Parser | null = null;
let initPromise: Promise<Parser> | null = null;

/**
 * Initialize the tree-sitter parser with SystemVerilog language support.
 * This function handles both browser and Node.js environments.
 *
 * @returns Promise resolving to initialized Parser instance
 */
export async function initParser(): Promise<Parser> {
  // Return cached parser if already initialized
  if (parserInstance) {
    return parserInstance;
  }

  // Return in-progress initialization if one exists
  if (initPromise) {
    return initPromise;
  }

  initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<Parser> {
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
    const lang = await Language.load('/tree-sitter-systemverilog.wasm');
    parser.setLanguage(lang);
    parserInstance = parser;
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
    const lang = await Language.load(wasmPath);
    parser.setLanguage(lang);
    parserInstance = parser;
    return parser;
  }
}

/**
 * Parse SystemVerilog source code into an AST.
 *
 * @param source - SystemVerilog source code string
 * @returns Promise resolving to the parsed tree
 */
export async function parseSystemVerilog(source: string): Promise<Parser.Tree> {
  const parser = await initParser();
  return parser.parse(source);
}

/**
 * Reset the parser instance (useful for testing).
 */
export function resetParser(): void {
  parserInstance = null;
  initPromise = null;
}
