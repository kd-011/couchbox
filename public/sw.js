// Offline-first shell: one-phone games must work with no connection, so the
// app shell and every game's files (from /games/index.json) are precached.
// Network-first at runtime so a deploy is picked up on the next load.
const CACHE = 'games-v11'; // bump on every frontend change
const SHELL = [
  '/', '/style.css', '/kit/kit.css', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-192.png', '/apple-touch-icon.png', '/fonts/bricolage.woff2',
  '/js/app.js', '/js/ui.js', '/js/games.js', '/js/markdown.js', '/js/surface.js', '/js/net.js', '/js/pass.js',
  '/js/room.js', '/js/tv.js', '/js/options.js', '/js/sfx.js', '/js/drinkui.js', '/js/nightui.js', '/js/reactui.js', '/js/packs.js',
  '/js/fx.js', '/js/morph.js', '/js/netbar.js', '/js/install.js', '/js/tvcast.js', '/js/howto.js', '/games/index.json',
  '/games/_kit/kit.js', '/games/_kit/runtime.js', '/games/_kit/palette.js', '/games/_kit/drinks.js', '/games/_kit/night.js', '/privacy', '/credits', '/404.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    try {
      const idx = await (await fetch('/games/index.json')).json();
      await c.addAll(idx.games.flatMap((g) => g.files));
    } catch { /* games still cache on first use */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname === '/ws' || url.pathname === '/healthz') return;
  const isPage = e.request.mode === 'navigate';
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (!isPage || url.pathname === '/')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        // Any app page (/, /r/CODE, /tv/CODE, /join) runs from the shell.
        if (isPage) return caches.match('/');
        return Response.error();
      }),
  );
});
