// Client side of game discovery: /games/index.json lists every game, and a
// game's engine/client/content load on demand (and from the service worker
// cache when offline).

let indexPromise = null;
const modules = new Map();

export async function fetchRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
  throw lastErr;
}

export function gameIndex() {
  if (!indexPromise) {
    indexPromise = fetchRetry('/games/index.json')
      .then((r) => r.json())
      .then((j) => j.games)
      .catch((err) => { indexPromise = null; throw err; });
  }
  return indexPromise;
}

export async function gameMeta(id) {
  return (await gameIndex()).find((g) => g.id === id) || null;
}

export function loadGame(id) {
  if (!/^[a-z0-9_-]+$/.test(id)) return Promise.reject(new Error(`bad game id ${id}`));
  if (!modules.has(id)) {
    const p = (async () => {
      const meta = await gameMeta(id);
      if (!meta) throw new Error(`No game called ${id}.`);
      const [engine, client, content] = await Promise.all([
        import(`/games/${id}/engine.js`),
        import(`/games/${id}/client.js`),
        fetchRetry(`/games/${id}/content.json`).then((r) => r.json()).catch(() => ({})),
      ]);
      if (meta.style && !document.querySelector(`link[data-game-style="${id}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `/games/${id}/style.css`;
        link.dataset.gameStyle = id;
        document.head.appendChild(link);
      }
      return { id, meta, engine, client, content };
    })();
    p.catch(() => modules.delete(id));
    modules.set(id, p);
  }
  return modules.get(id);
}

export async function loadRules(id) {
  const res = await fetchRetry(`/games/${id}/rules.md`);
  return res.text();
}

// Rendering lives in markdown.js so the server can reuse it for SEO pages.
export { renderMarkdown } from './markdown.js';

export function gameIcon(meta, size = 28) {
  // A game may ship games/<id>/icon.svg; otherwise its emoji stands in.
  if (meta.files && meta.files.includes(`/games/${meta.id}/icon.svg`)) {
    return `<img class="game-ico" src="/games/${meta.id}/icon.svg" width="${size}" height="${size}" alt="">`;
  }
  return `<span class="game-emoji" style="font-size:${size}px" aria-hidden="true">${meta.emoji}</span>`;
}
