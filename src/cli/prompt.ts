import { createInterface } from 'node:readline';

/** Prompts for secrets. On a terminal input is not echoed; from a pipe it reads line by line. */
export function createPrompt() {
  const piped = !process.stdin.isTTY;
  const rl = piped ? createInterface({ input: process.stdin, terminal: false }) : null;
  const iterator = rl?.[Symbol.asyncIterator]();

  async function readPiped(): Promise<string> {
    const next = await iterator!.next();
    return next.done ? '' : String(next.value);
  }

  function readHidden(): Promise<string> {
    return new Promise((resolve) => {
      const stdin = process.stdin;
      let value = '';
      stdin.setRawMode(true);
      stdin.resume();
      const onData = (chunk: Buffer) => {
        for (const char of chunk.toString('utf8')) {
          if (char === '\r' || char === '\n') {
            stdin.off('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
            resolve(value);
            return;
          }
          if (char === '\u0003') {
            stdin.setRawMode(false);
            process.exit(130);
          }
          if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
          else value += char;
        }
      };
      stdin.on('data', onData);
    });
  }

  return {
    async secret(question: string): Promise<string> {
      process.stderr.write(question);
      const value = piped ? await readPiped() : await readHidden();
      if (!piped) process.stderr.write('\n');
      return value;
    },
    close() {
      rl?.close();
    },
  };
}
