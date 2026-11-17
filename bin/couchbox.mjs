#!/usr/bin/env node
// The one-command start: `npx github:kd-011/couchbox`. Same server as `npm start`, listening on the
// network so phones can join, with the address and a QR code printed in the terminal.
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`couchbox needs Node 20 or newer, and this is Node ${process.versions.node}.`);
  process.exit(1);
}
process.argv.push('--lan');
await import('../server.mjs');
