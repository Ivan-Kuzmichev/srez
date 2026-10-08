/**
 * Service commands: `pnpm cli <command>` in development, `docker compose run --rm web cli <command>` in Docker.
 */
import { parseArgs } from 'node:util';
import './quiet-logs';
import { ZodError } from 'zod';
import { db } from '@/db/client';
import { ru } from '@/lib/i18n/ru';
import { auth } from '@/server/auth';
import { flushLogs, logger } from '@/server/logger';
import { createUser, resetPassword, UserError } from '@/server/users';
import { createPrompt } from './prompt';

type Command = { description: string; run(args: string[]): Promise<void> };

const log = () => logger('auth', { via: 'cli' });

async function askNewPassword(): Promise<string> {
  const prompt = createPrompt();
  try {
    const first = await prompt.secret(ru.cli.passwordPrompt);
    const second = await prompt.secret(ru.cli.passwordRepeat);
    if (first !== second) throw new UserError(ru.cli.passwordMismatch);
    return first;
  } finally {
    prompt.close();
  }
}

function usernameArg(args: string[], extra: Record<string, { type: 'boolean' }> = {}) {
  const { values } = parseArgs({ args, options: { username: { type: 'string' }, ...extra }, strict: true });
  if (!values.username) throw new UserError(ru.cli.missingUsername);
  return values as { username: string } & Record<string, boolean | string | undefined>;
}

const commands: Record<string, Command> = {
  'user:create': {
    description: ru.cli.userCreateHelp,
    async run(args) {
      const { username } = usernameArg(args);
      const password = await askNewPassword();
      await createUser(auth(), db(), { username, password });
      log().info({ username, event: 'user_created' }, 'User created');
      console.log(ru.cli.userCreated(username));
    },
  },
  'user:reset-password': {
    description: ru.cli.resetHelp,
    async run(args) {
      const values = usernameArg(args, {
        'disable-2fa': { type: 'boolean' },
        'remove-passkeys': { type: 'boolean' },
      });
      const password = await askNewPassword();
      const result = await resetPassword(db(), {
        username: values.username,
        password,
        disableTwoFactor: Boolean(values['disable-2fa']),
        removePasskeys: Boolean(values['remove-passkeys']),
      });
      log().warn(
        { username: values.username, event: 'password_reset', ...result },
        'Password reset from CLI',
      );
      console.log(ru.cli.passwordReset(values.username, result.sessionsEnded));
      if (result.twoFactorDisabled) console.log(ru.cli.twoFactorDisabled);
      if (values['remove-passkeys']) console.log(ru.cli.passkeysRemoved(result.passkeysRemoved));
    },
  },
};

function help(): void {
  console.log(`${ru.cli.usage}\n\n${ru.cli.commands}`);
  for (const [name, command] of Object.entries(commands))
    console.log(`  ${name.padEnd(22)}${command.description}`);
}

const [name, ...args] = process.argv.slice(2);
const command = name ? commands[name] : undefined;

if (!name || name === 'help' || name === '--help') {
  help();
} else if (!command) {
  console.error(`${ru.cli.unknown(name)}\n`);
  help();
  process.exitCode = 1;
} else {
  try {
    await command.run(args);
  } catch (err) {
    if (err instanceof ZodError) console.error(err.issues.map((i) => i.message).join('\n'));
    else if (err instanceof UserError || (err instanceof TypeError && 'code' in err))
      console.error(err.message);
    else throw err;
    process.exitCode = 1;
  } finally {
    flushLogs();
  }
}
