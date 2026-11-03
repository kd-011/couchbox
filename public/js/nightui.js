// Party Night on screen: the standings between games, the end-of-night
// awards ceremony, and the shareable recap image. Shared by the room phones,
// the /tv big screen and one-phone play. Numbers come from
// games/_kit/night.js; nothing here is secret (finished games only).
import * as ui from './ui.js';
import * as sfx from './sfx.js';
import * as fx from './fx.js';
import { standings, awards } from '/games/_kit/night.js';
import { gameIcon } from './games.js';

const AWARD_GAP_MS = 3400;

// d: { night, players, drink, metaOf(id) -> game meta|null }
export function standingsHTML(d, { big = false, still = false } = {}) {
  const { night, players, drink } = d;
  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = standings(night, players.map((p) => p.id));
  const max = Math.max(1, ...rows.map((r) => r.points));
  const last = night.played[night.played.length - 1];
  // Who won the game just played: everyone on the top score, unless the
  // whole table tied.
  const top = last && last.board.length ? last.board[0].score : 0;
  const winners = last && top > 0 ? last.board.filter((r) => r.score === top).map((r) => byId.get(r.id)).filter(Boolean) : [];
  const allSquare = !winners.length || winners.length === last.board.length;
  const next = night.queue[0] ? d.metaOf(night.queue[0]) : null;
  const anyShots = drink && Object.values(drink.tally).some((t) => t.shots > 0);
  const drinking = drink && (drink.tier !== 'standard' || Object.keys(drink.tally).length > 0);
  const shots = drink && (drink.tier === 'deadly' || anyShots);
  const n = night.played.length;
  return ui.html`<div class="nt nt-standings ${big ? 'nt-big' : ''} ${still ? 'nt-still' : ''}">
    <p class="nt-kicker">${ui.icon('trophy', big ? 30 : 16)}<span>Party Night · ${ui.plural(n, 'game')} played${night.queue.length ? ui.html` · ${night.queue.length} to go` : ''}</span></p>
    <h2 class="nt-title">Standings</h2>
    ${last ? ui.html`<p class="nt-last">${!allSquare
      ? ui.html`<span class="nt-winners">${winners.map((w) => ui.avatar(w, big ? 44 : 26))}</span><span><b>${winners.map((w) => w.name).join(' and ')}</b> won ${last.name}${last.finished ? '' : ' (ended early)'}</span>`
      : ui.html`<span>${last.name}: all square${last.finished ? '' : ', ended early'}</span>`}</p>` : ''}
    <ol class="nt-board">${rows.map((r, i) => {
      const p = byId.get(r.id);
      const t = drink && drink.tally[r.id];
      return ui.html`<li style="--i:${i};--w:${Math.round((r.points / max) * 100)}%;--c:${p.color}" class="${r.rank === 1 && r.points > 0 ? 'top' : ''}">
        <span class="nt-rank">${r.rank}</span>
        ${ui.avatar(p, big ? 64 : 36)}
        <span class="nt-name">${p.name}</span>
        <span class="nt-bar" aria-hidden="true"><i></i></span>
        ${r.delta ? ui.html`<span class="nt-delta">+${r.delta}</span>` : ui.html`<span class="nt-delta zero"></span>`}
        <b class="nt-pts">${r.points}</b>
        ${drinking ? ui.html`<span class="nt-tally" title="Sips and shots tonight">${ui.icon('glass', big ? 22 : 13)}${t ? t.sips : 0}${shots ? ui.html` ${ui.icon('shot', big ? 22 : 13)}${t ? t.shots : 0}` : ''}</span>` : ''}
      </li>`;
    })}</ol>
    ${next
      ? ui.html`<div class="nt-next" style="${ui.themeVars(next)}"><span>Up next</span>${ui.raw(gameIcon(next, big ? 64 : 30))}<strong>${next.name}</strong></div>`
      : ui.html`<p class="nt-endq">${n ? 'Nothing queued. One more game, or the awards?' : 'Pick the first game of the night.'}</p>`}
  </div>`;
}

// d: { night, players, drink }
export function awardsOf(d) {
  return awards(d.night, (d.drink && d.drink.tally) || {}, d.players.map((p) => p.id));
}

export function recapHTML(d, { big = false, ceremony = false, still = false } = {}) {
  const byId = new Map(d.players.map((p) => [p.id, p]));
  let list = awardsOf(d);
  // The TV fits two rows of three plus the champion.
  if (big) list = [...list.filter((a) => a.key !== 'points').slice(0, 6), ...list.filter((a) => a.key === 'points')];
  const n = d.night.played.length;
  const card = (a, i) => {
    const champ = a.key === 'points';
    return ui.html`<li class="aw ${champ ? 'aw-champ' : ''}" style="--i:${i};--gap:${ceremony ? AWARD_GAP_MS : 90}ms">
      <span class="aw-title">${champ ? ui.icon('trophy', big ? 40 : 20) : ''}${a.title}</span>
      <span class="aw-who">${a.winners.map((id) => ui.html`<span>${ui.avatar(byId.get(id), big ? (champ ? 120 : 72) : (champ ? 60 : 36))}<b>${(byId.get(id) || {}).name || 'Someone'}</b></span>`)}</span>
      <span class="aw-why">${a.blurb} · ${a.label}</span>
    </li>`;
  };
  return ui.html`<div class="nt nt-recap ${big ? 'nt-big' : ''} ${ceremony ? 'ceremony' : ''} ${still ? 'nt-still' : ''}">
    <p class="nt-kicker">${ui.icon('trophy', big ? 30 : 16)}<span>Party Night · ${ui.plural(n, 'game')}</span></p>
    <h2 class="nt-title">The Awards</h2>
    ${list.length ? ui.html`<ol class="aw-list">${list.map(card)}</ol>` : ui.html`<p class="nt-endq">No awards yet: finish a game first.</p>`}
  </div>`;
}

// Sound for the TV ceremony, in step with the CSS stagger.
export function playCeremony(count) {
  count = Math.min(count, 7);
  const timers = [];
  for (let i = 0; i < count; i++) {
    const champ = i === count - 1;
    timers.push(setTimeout(() => (champ ? sfx.drumroll(1.6) : sfx.chime()), i * AWARD_GAP_MS + (champ ? 0 : 400)));
    if (champ) timers.push(setTimeout(() => { sfx.fanfare(); fx.confetti({ count: 260 }); }, i * AWARD_GAP_MS + 1700));
  }
  return () => timers.forEach(clearTimeout);
}

/* the recap image */

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function disc(g, p, x, y, r) {
  g.fillStyle = (p && p.color) || '#8b7fb0';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(10,6,18,0.86)';
  const face = p && p.avatar;
  g.font = face ? `${Math.round(r * 1.1)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif` : `800 ${Math.round(r * 0.8)}px Bricolage, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(face || ui.initials(p ? p.name : '?'), x, y + r * 0.06);
}

function fitText(g, text, max) {
  let t = String(text);
  while (t.length > 1 && g.measureText(t).width > max) t = t.slice(0, -2) + '…';
  return t;
}

// 1080x1350 PNG of the night: champion, standings, awards. Returns a Blob.
export async function recapImage(d) {
  try { await document.fonts.load('800 64px Bricolage'); } catch { /* system font then */ }
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const byId = new Map(d.players.map((p) => [p.id, p]));
  g.fillStyle = '#0e0a16';
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, -100, 50, W / 2, -100, 900);
  glow.addColorStop(0, 'rgba(157,123,255,0.35)');
  glow.addColorStop(1, 'rgba(157,123,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffb347';
  g.font = '700 30px system-ui, sans-serif';
  const date = new Date(d.night.startedAt || Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  g.fillText(`PARTY NIGHT · ${date.toUpperCase()}`, 72, 110);
  g.fillStyle = '#f5f1ff';
  g.font = '800 92px Bricolage, system-ui, sans-serif';
  g.fillText(`${d.night.played.length} game${d.night.played.length === 1 ? '' : 's'}, one champion`, 72, 205, W - 144);

  const rows = standings(d.night, d.players.map((p) => p.id));
  const champ = rows[0] && rows[0].points > 0 ? byId.get(rows[0].id) : null;
  let y = 270;
  if (champ) {
    roundRect(g, 60, y, W - 120, 200, 36);
    g.fillStyle = 'rgba(255,179,71,0.14)';
    g.fill();
    disc(g, champ, 170, y + 100, 70);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffb347';
    g.font = '700 28px system-ui, sans-serif';
    g.fillText('CHAMPION OF THE NIGHT', 270, y + 80);
    g.fillStyle = '#f5f1ff';
    g.font = '800 72px Bricolage, system-ui, sans-serif';
    g.fillText(fitText(g, champ.name, 560), 270, y + 155);
    g.fillStyle = '#ffb347';
    g.font = '800 64px Bricolage, system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(String(rows[0].points), W - 100, y + 125);
    y += 240;
  }

  g.textAlign = 'left';
  g.fillStyle = '#8d83aa';
  g.font = '700 26px system-ui, sans-serif';
  g.fillText('STANDINGS', 72, y + 20);
  y += 44;
  const tally = (d.drink && d.drink.tally) || {};
  const drinking = d.drink && d.drink.tier !== 'standard';
  for (const r of rows.slice(champ ? 1 : 0, champ ? 6 : 5)) {
    const p = byId.get(r.id);
    disc(g, p, 100, y + 34, 26);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#b5abcf';
    g.font = '700 30px system-ui, sans-serif';
    g.fillText(String(r.rank), 40, y + 45);
    g.fillStyle = '#f5f1ff';
    g.font = '700 38px Bricolage, system-ui, sans-serif';
    g.fillText(fitText(g, p.name, drinking ? 400 : 620), 146, y + 47);
    g.textAlign = 'right';
    g.font = '800 40px Bricolage, system-ui, sans-serif';
    g.fillText(String(r.points), W - 100, y + 48);
    if (drinking && tally[r.id]) {
      g.fillStyle = '#ffb347';
      g.font = '600 26px system-ui, sans-serif';
      g.fillText(`${tally[r.id].sips} sips${d.drink.tier === 'deadly' ? ` · ${tally[r.id].shots} shots` : ''}`, W - 180, y + 46);
    }
    y += 72;
  }

  const list = awardsOf(d).filter((a) => a.key !== 'points').slice(0, 6);
  if (list.length) {
    y += 24;
    g.textAlign = 'left';
    g.fillStyle = '#8d83aa';
    g.font = '700 26px system-ui, sans-serif';
    g.fillText('AWARDS', 72, y + 20);
    y += 40;
    const colW = (W - 144 - 24) / 2;
    list.forEach((a, i) => {
      const x = 72 + (i % 2) * (colW + 24);
      const yy = y + Math.floor(i / 2) * 118;
      roundRect(g, x, yy, colW, 100, 24);
      g.fillStyle = '#1b1429';
      g.fill();
      g.fillStyle = '#ffb347';
      g.font = '700 24px system-ui, sans-serif';
      g.fillText(a.title.toUpperCase(), x + 24, yy + 38);
      g.fillStyle = '#f5f1ff';
      g.font = '700 32px Bricolage, system-ui, sans-serif';
      g.fillText(fitText(g, a.winners.map((id) => (byId.get(id) || {}).name || '?').join(' & '), colW - 48), x + 24, yy + 78);
    });
  }

  // The games of the night, in order.
  g.textAlign = 'left';
  g.fillStyle = '#8d83aa';
  g.font = '700 26px system-ui, sans-serif';
  g.fillText('THE NIGHT', 72, H - 170);
  g.fillStyle = '#b5abcf';
  g.font = '600 30px system-ui, sans-serif';
  g.fillText(fitText(g, d.night.played.map((p) => p.name).join('  ·  '), W - 144), 72, H - 126);
  g.textAlign = 'center';
  g.fillStyle = '#8d83aa';
  g.font = '600 28px system-ui, sans-serif';
  g.fillText(`Free party games, no sign-up: ${location.host}`, W / 2, H - 50);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the image'))), 'image/png'));
}

// Share the recap image (phone share sheet) or download it.
export async function shareRecap(d, btn) {
  if (btn) btn.classList.add('busy');
  try {
    const blob = await recapImage(d);
    const file = new File([blob], 'party-night.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Party Night', text: `Our Party Night on ${location.host}` }); } catch { /* cancelled */ }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'party-night.png';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      ui.toast('Recap image saved', 'info');
    }
    ui.haptic('success');
  } catch (err) {
    ui.toast("Couldn't make the recap image", 'error', String(err.message || err));
  } finally {
    if (btn && btn.isConnected) btn.classList.remove('busy');
  }
}

// Pick a game for the night. list: game metas; returns an id or null.
export async function pickGameSheet(title, list, { players = 0, current = null } = {}) {
  const v = await ui.sheet({
    title,
    body: ui.html`<div class="pick-games">${list.map((g) => {
      const fits = !players || (players >= g.minPlayers && players <= g.maxPlayers);
      return ui.html`<button class="game-row" data-value="${g.id}" style="${ui.themeVars(g)}" ${fits ? '' : 'disabled'}>
        <span class="game-row-ico">${ui.raw(gameIcon(g, 28))}</span>
        <span class="game-row-text"><strong>${g.name}</strong><span>${fits ? `${g.minPlayers}-${g.maxPlayers} players` : `Needs ${g.minPlayers}-${g.maxPlayers} players`}</span></span>
        ${g.id === current ? ui.icon('check', 20) : ''}</button>`;
    })}</div>`,
  });
  return v || null;
}
