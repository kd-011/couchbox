// WebSocket client for rooms: auto-reconnect with backoff, request/ack,
// a heartbeat to notice dead connections, and a short-lived queue so a tap
// made during a blip is sent once the socket is back.
//
// A queued request (opts.queue: every game action) is never lost to a drop:
// if it was sent on a socket that died before the ack, it goes out again on
// the next one with the same id and a `rid` the server uses to apply it once.

// Heartbeat: a ping every PING_MS, and the socket is declared dead after
// DEAD_MS without hearing anything. A waking phone does not wait for either:
// it probes the socket and gives it PROBE_MS to answer.
const PING_MS = 10_000;
const DEAD_MS = 25_000;
const PROBE_AFTER_MS = 5_000;
const PROBE_MS = 4_000;
const CONNECT_MS = 10_000; // a handshake that has not finished by then is stuck
const QUEUE_MS = 60_000;

export class RoomSocket {
  constructor({ onMessage, onStatus, onOpen }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.onOpen = onOpen || (() => {});
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.attempt = 0;
    this.closed = false;
    this.ready = false; // open AND (re)subscribed to the room
    this.retryTimer = null;
    this.beat = null;
    this.connectTimer = null;
    this.probeTimer = null;
    this.lastHeard = 0;
    // Coming back (screen on, tab shown, network back): a dead socket should
    // be found now, not at the next heartbeat.
    this.kick = () => {
      if (document.visibilityState === 'hidden') return;
      if (!this.ws || this.ws.readyState > 1) return this.reconnectNow();
      this.probe();
    };
    window.addEventListener('online', this.kick);
    document.addEventListener('visibilitychange', this.kick);
  }

  get url() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  connect() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    this.onStatus(this.attempt ? 'reconnecting' : 'connecting');
    let ws;
    try { ws = new WebSocket(this.url); } catch { return this.scheduleRetry(); }
    this.ws = ws;
    // A handshake that hangs (half-open path, captive wifi) can sit for
    // minutes in the browser: give up on it and try again.
    this.connectTimer = setTimeout(() => { if (this.ws === ws && ws.readyState === 0) ws.close(); }, CONNECT_MS);
    ws.onopen = () => {
      clearTimeout(this.connectTimer);
      this.attempt = 0;
      this.lastHeard = Date.now();
      this.startBeat();
      this.onOpen();
    };
    ws.onmessage = (e) => {
      this.lastHeard = Date.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if ((msg.t === 'ack' || msg.t === 'error') && msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve(msg.t === 'ack' ? { ok: true } : { error: msg.message, code: msg.code });
        if (msg.t === 'error') this.onMessage({ ...msg, solicited: true, req: p.msg });
        return;
      }
      if (msg.t === 'pong') return;
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.connectTimer);
      this.ready = false;
      this.stopBeat();
      this.scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  scheduleRetry() {
    if (this.closed) return;
    this.onStatus('reconnecting');
    const delay = Math.min(8000, 400 * 2 ** this.attempt) + Math.random() * 300;
    this.attempt++;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  reconnectNow() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
    clearTimeout(this.probeTimer);
    this.probeTimer = null;
    this.stopBeat();
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch { /* already closed */ } }
    this.ready = false;
    this.connect();
  }

  // Ask a socket that has been quiet whether it is still there.
  probe() {
    if (!this.ws || this.ws.readyState !== 1 || this.probeTimer) return;
    if (Date.now() - this.lastHeard < PROBE_AFTER_MS) return;
    const asked = Date.now();
    this.ws.send(JSON.stringify({ t: 'ping' }));
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      if (this.lastHeard < asked) this.reconnectNow();
    }, PROBE_MS);
  }

  startBeat() {
    this.stopBeat();
    this.beat = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      if (Date.now() - this.lastHeard > DEAD_MS) return this.reconnectNow();
      this.ws.send(JSON.stringify({ t: 'ping' }));
    }, PING_MS);
  }

  stopBeat() {
    clearInterval(this.beat);
    this.beat = null;
  }

  // Send now if possible. Returns a promise of { ok } or { error }.
  // opts.queue: if not connected, hold it for up to 60s and send after the
  // next successful (re)join instead of failing; if it was sent but never
  // acked before the socket died, send it again then.
  request(msg, opts = {}) {
    const id = ++this.seq;
    const full = { ...msg, id };
    if (opts.queue) full.rid = `${Math.random().toString(36).slice(2, 10)}${id}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ error: 'No answer from the server. Check your connection and try again.' });
      }, opts.timeout || 9000);
      const entry = { resolve, timer, msg, full, resend: !!opts.queue, sentOn: null, at: Date.now() };
      this.pending.set(id, entry);
      const open = this.ws && this.ws.readyState === 1 && (this.ready || opts.subscribe);
      if (open) {
        this.ws.send(JSON.stringify(full));
        entry.sentOn = this.ws;
      } else if (!opts.queue) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ error: 'Not connected. Reconnecting now...' });
      }
    });
  }

  // Call once the room subscription (join/tv) is acknowledged.
  markReady() {
    this.ready = true;
    this.onStatus('open');
    const now = Date.now();
    for (const e of this.pending.values()) {
      if (!e.resend || e.sentOn === this.ws || now - e.at >= QUEUE_MS) continue;
      e.sentOn = this.ws;
      this.ws.send(JSON.stringify(e.full));
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
    clearTimeout(this.probeTimer);
    this.probeTimer = null;
    this.stopBeat();
    window.removeEventListener('online', this.kick);
    document.removeEventListener('visibilitychange', this.kick);
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch { /* fine */ } }
  }
}
