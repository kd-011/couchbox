// Running on a home network: find this computer's address, tell a plain http host from one behind TLS,
// and print something a person can act on. Only `--lan` and the party-games command use the address.
import { networkInterfaces } from 'node:os';
import qrcode from 'qrcode-generator';

// Container bridges and VPNs have addresses too, but a phone on the wifi cannot reach them.
const VIRTUAL = /^(docker|br-|veth|virbr|vmnet|vboxnet|tailscale|zt|wg|tun|tap|utun|podman|cni|flannel)/i;

function rank(address) {
  if (address.startsWith('192.168.')) return 3;
  if (address.startsWith('10.')) return 2;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 1;
  return 0;
}

/** The IPv4 address other devices on this network can reach, or null when there is no network. */
export function lanAddress(ifaces = networkInterfaces()) {
  const found = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) found.push(a.address);
    }
  }
  found.sort((a, b) => rank(b) - rank(a));
  return found[0] ?? null;
}

export function isLoopbackHost(host) {
  return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i.test(String(host ?? ''));
}

/** True for a Host header only a home network could mean: nothing issues a certificate for these. */
export function isPlainHttpHost(host) {
  const name = String(host ?? '').replace(/:\d+$/, '');
  return isLoopbackHost(name)
    || rank(name) > 0 && /^[\d.]+$/.test(name)
    || !name.includes('.')
    || /\.(local|lan|home|internal)$/i.test(name);
}

export function terminalQr(text) {
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  return qr.createASCII(1, 2);
}

/** What the terminal says once the server is up in LAN mode. */
export function lanBanner({ address, port }) {
  if (!address) {
    return [
      '',
      `  Party Games is running at http://localhost:${port}`,
      '',
      '  This computer has no network right now, so only its own browser can reach it.',
      '  Ctrl+C to stop.',
      '',
    ].join('\n');
  }
  const url = `http://${address}:${port}`;
  return [
    '',
    `  Party Games is running at ${url}`,
    '',
    '  Open that on any phone or computer on this network, or scan this:',
    '',
    terminalQr(url).split('\n').map((line) => `  ${line}`).join('\n'),
    '',
    '  Anyone on this network can reach it. Ctrl+C to stop.',
    '',
  ].join('\n');
}
