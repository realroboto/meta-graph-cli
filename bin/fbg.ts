#!/usr/bin/env node
// Shell around the seam: build the real io/fs, call run, write the two streams,
// exit with the code. No logic beyond wiring the injected I/O.
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { run } from '../src/run.ts';

const io = {
  // Prompt on the tty. When hidden, the typed characters are muted by a
  // pass-through output stream that drops writes once the label is printed.
  async prompt(label: string, opts?: { hidden?: boolean }): Promise<string> {
    let muted = false;
    const output = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output, terminal: true });
    const answer = rl.question(`${label}: `);
    muted = Boolean(opts?.hidden);
    try {
      return await answer;
    } finally {
      rl.close();
      if (opts?.hidden) process.stdout.write('\n');
    }
  },
};

const fs = {
  async readFile(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return null; // absent -> no saved credential
    }
  },
  writeFile: (path: string, data: string) => writeFile(path, data, { mode: 0o600 }),
  mkdir: async (path: string, opts: { recursive: boolean; mode: number }) => {
    await mkdir(path, opts);
  },
  chmod: (path: string, mode: number) => chmod(path, mode),
  async rm(path: string) {
    try {
      await rm(path);
    } catch {
      // already gone -> idempotent
    }
  },
};

const { stdout, stderr, code } = await run(process.argv.slice(2), {
  fetch,
  env: process.env,
  io,
  fs,
});

if (stdout) process.stdout.write(`${stdout}\n`);
if (stderr) process.stderr.write(`${stderr}\n`);
process.exit(code);
