// public/js/net.js, the room websocket client, against a fake WebSocket and
// fake timers: a tap made as the connection dies is not lost, and a phone
// that wakes up on a dead socket notices fast.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeWS {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWS.all.push(this); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  open() { this.readyState = 1; this.onopen(); }
  recv(obj) { this.onmessage({ data: JSON.stringify(obj) }); }
  drop() { this.readyState = 3; if (this.onclose) this.onclose(); }
}

const listeners = { window: {}, document: {} };
const on = (where) => (name, fn) => { (listeners[where][name] ||= []).push(fn); };
const off = (where) => (name, fn) => { listeners[where][name] = (listeners[where][name] || []).filter((f) => f !== fn); };
let visibility = 'visible';
globalThis.window = { addEventListener: on('window'), removeEventListener: off('window') };
globalThis.document = {
  addEventListener: on('document'), removeEventListener: off('document'),
  get visibilityState() { return visibility; },
};
globalThis.location = { protocol: 'http:', host: 'x.test' };
globalThis.WebSocket = FakeWS;

const { RoomSocket } = await import('../public/js/net.js');

function make(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  FakeWS.all = [];
  const log = { status: [], msgs: [] };
  const sock = new RoomSocket({
    onMessage: (m) => log.msgs.push(m),
    onStatus: (s) => log.status.push(s),
    onOpen: () => {},
  });
  sock.connect();
  FakeWS.all[0].open();
  sock.markReady();
  return { sock, log, ws: () => FakeWS.all[FakeWS.all.length - 1] };
}

test('an act sent on a socket that then dies is re-sent, same id and rid, on the new one', (t) => {
  const { sock, ws } = make(t);
  const first = ws();
  const p = sock.request({ t: 'act', type: 'vote', payload: 'p2' }, { queue: true, timeout: 60_000 });
  assert.equal(first.sent.length, 1);
  const { id, rid } = first.sent[0];
  assert.ok(rid, 'queued acts carry a rid so the server can drop a duplicate');
  // The tunnel flaps: no ack ever arrives.
  first.drop();
  t.mock.timers.tick(2000);
  const second = ws();
  assert.notEqual(second, first);
  second.open();
  sock.markReady();
  assert.equal(second.sent.length, 1, 'the unacked tap goes out again');
  assert.equal(second.sent[0].id, id);
  assert.equal(second.sent[0].rid, rid);
  second.recv({ t: 'ack', id });
  return p.then((r) => assert.deepEqual(r, { ok: true }));
});

test('an acked act is never re-sent', (t) => {
  const { sock, ws } = make(t);
  const first = ws();
  const p = sock.request({ t: 'act', type: 'vote', payload: 'p2' }, { queue: true, timeout: 60_000 });
  first.recv({ t: 'ack', id: first.sent[0].id });
  first.drop();
  t.mock.timers.tick(2000);
  ws().open();
  sock.markReady();
  assert.equal(ws().sent.length, 0);
  return p;
});

test('a plain host request is not re-sent after a drop (it fails, it is not repeated)', (t) => {
  const { sock, ws } = make(t);
  const first = ws();
  sock.request({ t: 'host', op: 'next' });
  first.drop();
  t.mock.timers.tick(2000);
  ws().open();
  sock.markReady();
  assert.equal(ws().sent.length, 0);
});

test('a tap made while offline is queued, then sent once on the next join', (t) => {
  const { sock, ws } = make(t);
  ws().drop();
  sock.request({ t: 'act', type: 'vote', payload: 'p2' }, { queue: true, timeout: 60_000 });
  t.mock.timers.tick(2000);
  ws().open();
  assert.equal(ws().sent.length, 0, 'not before the room is re-joined');
  sock.markReady();
  assert.equal(ws().sent.length, 1);
});

test('a phone that wakes on a silent dead socket reconnects within seconds, not 35', (t) => {
  const { sock, ws } = make(t);
  const dead = ws();
  t.mock.timers.tick(9000); // asleep: nothing heard for 9s, under every heartbeat limit
  const sent = dead.sent.length;
  for (const fn of listeners.document.visibilitychange || []) fn();
  assert.ok(dead.sent.length > sent && dead.sent.at(-1).t === 'ping', 'probes the socket on resume');
  t.mock.timers.tick(5000); // no pong
  assert.notEqual(ws(), dead, 'gave up on it and opened a new one');
  sock.close();
});

test('a phone that wakes on a healthy socket keeps it', (t) => {
  const { sock, ws } = make(t);
  const live = ws();
  t.mock.timers.tick(9000);
  const sent = live.sent.length;
  for (const fn of listeners.document.visibilitychange || []) fn();
  assert.ok(live.sent.length > sent && live.sent.at(-1).t === 'ping');
  live.recv({ t: 'pong', now: 1 });
  t.mock.timers.tick(5000);
  assert.equal(ws(), live);
  sock.close();
});

test('a connection attempt that never completes is abandoned and retried', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  FakeWS.all = [];
  const sock = new RoomSocket({ onMessage() {}, onStatus() {}, onOpen() {} });
  sock.connect();
  const stuck = FakeWS.all[0]; // handshake never answers (readyState stays 0)
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(2000); // the mock clock does not run timers set during a tick
  assert.ok(FakeWS.all.length > 1, 'opened another socket instead of waiting on the browser');
  assert.equal(stuck.readyState, 3, 'and closed the stuck one');
  sock.close();
});

test('a heartbeat reconnect during a probe does not switch off later wake-up probes', (t) => {
  const { sock, ws } = make(t);
  const first = ws();
  t.mock.timers.tick(9000);
  for (const fn of listeners.document.visibilitychange || []) fn(); // probe in flight
  assert.equal(first.sent.at(-1).t, 'ping');
  sock.reconnectNow(); // e.g. the heartbeat gave up inside the 4s probe window
  const second = ws();
  assert.notEqual(second, first);
  second.open();
  sock.markReady();
  t.mock.timers.tick(9000);
  const sent = second.sent.length;
  for (const fn of listeners.document.visibilitychange || []) fn();
  assert.ok(second.sent.length > sent && second.sent.at(-1).t === 'ping', 'a second wake still probes');
  sock.close();
});
