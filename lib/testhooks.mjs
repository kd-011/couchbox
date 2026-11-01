// QA hooks for e2e/matrix.mjs's browser layer: read a room's real game state
// (so a bot can pick a legal move and then tap it on a real phone), fire a
// pending timer now, and make a move that has no button to tap. Wired in by
// server.mjs only when GAMES_TEST_HOOKS=1, which is for a local test server
// and never set in production: anyone holding a room code could read every
// secret in it.
import * as rt from '../games/_kit/runtime.js';

export function makeTestHooks({ rooms, games }) {
  const roomOf = (code) => rooms.rooms.get(String(code || '').toUpperCase()) || null;

  function snapshot(room) {
    return {
      code: room.code,
      gameId: room.gameId,
      stage: room.stage,
      hostId: room.hostId,
      packCode: room.packCode,
      players: [...room.players.values()].map(({ id, name }) => ({ id, name })),
      inGame: room.state ? rooms.inGameIds(room) : [],
      night: { played: room.night.played.length, queue: room.night.queue },
      state: room.state,
    };
  }

  // GET  /__test/room/CODE            the snapshot
  // POST /__test/room/CODE/deadline   fire the pending timer now
  // POST /__test/room/CODE/act        { playerId, type, payload } as that player
  return function handle(req, res, pathname, sendJson, readBody) {
    const m = /^\/__test\/room\/([A-Za-z]{4})(?:\/(deadline|act))?$/.exec(pathname);
    if (!m) return false;
    const room = roomOf(m[1]);
    if (!room) { sendJson(res, 404, { error: 'no room' }); return true; }
    if (!m[2]) { sendJson(res, 200, snapshot(room)); return true; }
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST' }); return true; }
    readBody(req, 16 * 1024, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'bad body' });
      if (!room.state) return sendJson(res, 409, { error: 'no game running' });
      const g = games.get(room.gameId);
      const ctx = rooms.ctx(room);
      let action;
      if (m[2] === 'deadline') {
        const d = rt.deadlineOf(g.engine, room.state);
        if (!d) return sendJson(res, 409, { error: 'no deadline' });
        action = { type: d.type, payload: null, from: null, host: false, system: true };
      } else {
        const id = body && body.playerId;
        action = { type: String(body && body.type), payload: body ? body.payload ?? null : null, from: id || room.hostId, host: !id || id === room.hostId };
      }
      const r = rt.applyAction(g.engine, room.state, action, ctx);
      if (r.error) return sendJson(res, 400, { error: r.error, detail: r.detail || null });
      room.state = r.state;
      rooms.afterChange(room);
      sendJson(res, 200, { ok: true });
    });
    return true;
  };
}
