#!/usr/bin/env node
// Shell around the seam: call run, write the two streams, exit with the code.
// No logic beyond that.
import { run } from '../src/run.ts';

const { stdout, stderr, code } = await run(process.argv.slice(2), {
  fetch,
  env: process.env,
});

if (stdout) process.stdout.write(`${stdout}\n`);
if (stderr) process.stderr.write(`${stderr}\n`);
process.exit(code);
