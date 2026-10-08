/**
 * Service commands: `pnpm cli <command>` in development, `docker compose run --rm web cli <command>` in Docker.
 * user:create and user:reset-password arrive in phase 1.
 */
type Command = { description: string; run(args: string[]): Promise<void> | void };

const commands: Record<string, Command> = {};

function help(): void {
  console.log('Usage: cli <command> [args]\n');
  const names = Object.keys(commands);
  if (names.length === 0) console.log('No commands yet.');
  for (const name of names) console.log(`  ${name.padEnd(24)}${commands[name]!.description}`);
}

const [name, ...args] = process.argv.slice(2);
const command = name ? commands[name] : undefined;

if (!name || name === 'help' || name === '--help') {
  help();
} else if (!command) {
  console.error(`Unknown command: ${name}\n`);
  help();
  process.exitCode = 1;
} else {
  await command.run(args);
}

export {};
