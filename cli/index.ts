import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { extract, extractFSMs, mightContainFSM } from '../src/index.js';
import type { ExtractOptions } from '../src/types.js';

const program = new Command();

program
  .name('fsm_viz')
  .description('Extract FSM state machines from SystemVerilog and generate Mermaid diagrams')
  .version('1.0.0');

program
  .command('extract')
  .description('Extract FSM from a SystemVerilog file')
  .argument('<file>', 'SystemVerilog file to process')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('-f, --format <format>', 'Output format: mermaid | json (default: mermaid)', 'mermaid')
  .option('-d, --direction <dir>', 'Diagram direction: TB | LR (default: TB)', 'TB')
  .option('-c, --conditions', 'Include transition conditions', true)
  .option('-p, --outputs', 'Include Moore/Mealy outputs', false)
  .option('-w, --warnings', 'Show validation warnings', false)
  .option('-m, --module <name>', 'Extract specific module only')
  .option('--fsm <name>', 'Extract specific FSM (if multiple per module)')
  .action(async (file: string, opts) => {
    try {
      // Check file exists
      if (!existsSync(file)) {
        console.error(`Error: File not found: ${file}`);
        process.exit(1);
      }

      // Read source
      const source = readFileSync(file, 'utf-8');

      // Quick check
      if (!mightContainFSM(source)) {
        console.error('Warning: Source does not appear to contain FSM patterns.');
        console.error('Attempting extraction anyway...');
      }

      // Extract options
      const extractOpts: Partial<ExtractOptions> = {
        format: opts.format as 'mermaid' | 'json',
        direction: opts.direction as 'TB' | 'LR',
        conditions: opts.conditions,
        outputs: opts.outputs,
        warnings: opts.warnings,
        module: opts.module,
        fsm: opts.fsm,
      };

      // Extract
      const output = await extract(source, extractOpts);

      // Output
      if (opts.output) {
        writeFileSync(opts.output, output);
        console.error(`Output written to: ${opts.output}`);
      } else {
        console.log(output);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze FSM structure without generating output')
  .argument('<file>', 'SystemVerilog file to process')
  .action(async (file: string) => {
    try {
      if (!existsSync(file)) {
        console.error(`Error: File not found: ${file}`);
        process.exit(1);
      }

      const source = readFileSync(file, 'utf-8');
      const analysis = await extractFSMs(source);

      console.log(`Module: ${analysis.moduleName}`);
      console.log(`FSMs found: ${analysis.fsms.length}`);
      console.log('');

      for (const fsm of analysis.fsms) {
        console.log(`FSM: ${fsm.name}`);
        console.log(`  States: ${fsm.states.map((s) => s.name).join(', ')}`);
        console.log(`  Transitions: ${fsm.transitions.length}`);
        console.log(`  Reset state: ${fsm.resetState || 'not detected'}`);
        console.log(`  Block style: ${fsm.blockStyle}`);
        console.log(`  Confidence: ${(fsm.confidence * 100).toFixed(0)}%`);

        if (fsm.warnings.length > 0) {
          console.log('  Warnings:');
          for (const warning of fsm.warnings) {
            console.log(`    - ${warning.type}: ${warning.message}`);
          }
        }

        console.log('');
      }

      if (analysis.parseErrors.length > 0) {
        console.log('Parse errors:');
        for (const error of analysis.parseErrors) {
          console.log(`  - ${error}`);
        }
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program
  .command('check')
  .description('Quick check if a file might contain an FSM')
  .argument('<file>', 'SystemVerilog file to check')
  .action((file: string) => {
    try {
      if (!existsSync(file)) {
        console.error(`Error: File not found: ${file}`);
        process.exit(1);
      }

      const source = readFileSync(file, 'utf-8');
      const mightHaveFSM = mightContainFSM(source);

      if (mightHaveFSM) {
        console.log('File appears to contain FSM patterns.');
        process.exit(0);
      } else {
        console.log('File does not appear to contain FSM patterns.');
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Parse arguments
program.parse();
