import type { Command } from 'commander';

import {
  PRODUCT,
  SHELLS,
  assertShell,
  completionInstructions,
  generateCompletion,
  print,
  printResult,
} from '../core/index.js';

export function registerCompletionCommand(program: Command): void {
  program
    .command('completion')
    .argument('[shell]', `one of ${SHELLS.join(', ')}`)
    .description('print the shell completion script')
    .action((shell: string | undefined, _options: unknown, command: Command) => {
      const root = command.parent ?? program;

      if (shell === undefined) {
        const instructions = Object.fromEntries(
          SHELLS.map((name) => [name, completionInstructions(name, PRODUCT.binName)]),
        );

        printResult('completion', { shells: [...SHELLS], instructions });

        print(`Pick a shell: ${PRODUCT.binName} completion <shell>`);
        print('');
        for (const name of SHELLS) {
          print(`  ${name}`);
          for (const line of completionInstructions(name, PRODUCT.binName).split('\n')) {
            print(`  ${line}`);
          }
          print('');
        }
        return;
      }

      const target = assertShell(shell.toLowerCase());
      process.stdout.write(`${generateCompletion(root, target, { name: PRODUCT.binName }).trimEnd()}\n`);
      process.stderr.write(`${completionInstructions(target, PRODUCT.binName)}\n`);
    });
}
