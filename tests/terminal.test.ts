import assert from 'node:assert/strict';
import { test } from 'node:test';

import { interactiveTerminalEnabled, withTerminalProgress } from '../src/terminal.js';

const tty = { isTTY: true } as NodeJS.WriteStream;
const pipe = { isTTY: false } as NodeJS.WriteStream;

test('interactive DX is enabled only for a human TTY', () => {
  assert.equal(interactiveTerminalEnabled(tty, {}), true);
  assert.equal(interactiveTerminalEnabled(pipe, {}), false);
  assert.equal(interactiveTerminalEnabled(tty, { CI: 'true' }), false);
  assert.equal(interactiveTerminalEnabled(tty, { NO_COLOR: '1' }), false);
  assert.equal(interactiveTerminalEnabled(tty, { TERM: 'dumb' }), false);
});

test('disabled progress runs the operation without writing terminal frames', async () => {
  let reports = 0;
  const value = await withTerminalProgress(
    'Checking…',
    async (report) => {
      report('Still checking…');
      reports += 1;
      return 42;
    },
    false,
  );
  assert.equal(value, 42);
  assert.equal(reports, 1);
});
