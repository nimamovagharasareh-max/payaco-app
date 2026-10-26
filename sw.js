// App shell cache. API calls (Supabase) always go to the network and are never cached.
const CACHE = "payaco-shell-v2.20.0";
const SHELL = ["./", "index.html", "styles.css?v=2.20.0", "app.js?v=2.20.0", "config.js?v=2.20.0", "manifest.webmanifest", "icons/icon-192.png", "icons/logo.png", "icons/mark.png", "icons/nima-mark.png", "icons/nima-mark-dark.png", "fonts/Vazirmatn-var.woff2"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // network first so a new deploy is picked up immediately; cache is the offline fallback
  e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});
