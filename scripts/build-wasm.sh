#!/bin/bash
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

# Check if tree-sitter-systemverilog exists
if [ ! -d "node_modules/tree-sitter-systemverilog" ]; then
    echo "ERROR: tree-sitter-systemverilog not found in node_modules"
    echo "Run 'npm install' first"
    exit 1
fi

# Build the WASM (modern syntax: build --wasm, not build-wasm)
# First run will auto-download WASI SDK (~40MB) to ~/.cache/tree-sitter/
echo "Building WASM (first run downloads WASI SDK)..."
npx tree-sitter build --wasm node_modules/tree-sitter-systemverilog

# Verify output exists
if [ ! -f "tree-sitter-systemverilog.wasm" ]; then
    echo "ERROR: WASM build produced no output"
    exit 1
fi

# Create directories if they don't exist
mkdir -p public dist

# Copy to public directory (for web) and dist directory (for CLI)
cp tree-sitter-systemverilog.wasm public/
cp tree-sitter-systemverilog.wasm dist/
cp node_modules/web-tree-sitter/tree-sitter.wasm public/
cp node_modules/web-tree-sitter/tree-sitter.wasm dist/

# Clean up the root copy
rm -f tree-sitter-systemverilog.wasm

echo "=== WASM build successful ==="
echo "Files created:"
ls -la public/*.wasm dist/*.wasm 2>/dev/null || echo "WASM files copied successfully"
