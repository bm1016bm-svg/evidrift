import process from 'node:process';

import ora from 'ora';

export type ProgressReporter = (message: string) => void;

export function interactiveTerminalEnabled(
  stream: NodeJS.WriteStream = process.stdout,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    stream.isTTY === true &&
    environment.CI === undefined &&
    environment.NO_COLOR === undefined &&
    environment.TERM !== 'dumb'
  );
}

export async function withTerminalProgress<T>(
  initialMessage: string,
  operation: (report: ProgressReporter) => Promise<T>,
  enabled = interactiveTerminalEnabled(process.stderr),
): Promise<T> {
  if (!enabled) {
    return operation(() => undefined);
  }

  const spinner = ora({
    text: initialMessage,
    color: 'cyan',
    spinner: 'dots',
    stream: process.stderr,
  }).start();
  try {
    return await operation((message) => {
      spinner.text = message;
    });
  } finally {
    spinner.stop();
  }
}
