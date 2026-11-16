// Service worker template. The build (vite.web.config.ts) fills in the cache version and the
// list of files to precache, then emits it as sw.js. Every build gets its own cache; older caches
// are deleted on activate.
const CACHE = 'flashcards-__VERSION__'
const PRECACHE = __PRECACHE__

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // Add files one by one so a single failure doesn't abort the whole install.
      Promise.all(PRECACHE.map((url) => c.add(url).catch(() => {})))
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return
  if (req.mode === 'navigate') {
    // Network first, so a reload always gets the newest version when online.
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache good pages: an error page must never replace the offline copy.
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put('./index.html', copy))
          }
          return res
        })
        .catch(() => caches.match('./index.html'))
    )
    return
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
    )
  )
})
