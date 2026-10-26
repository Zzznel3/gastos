// Service worker: guarda la app en el teléfono para que abra sin internet.
// Los datos de Supabase no pasan por aquí (la app maneja su propia cola offline).
const CACHE = 'gastos-v1';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js';
const ARCHIVOS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/config.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  SUPABASE_JS,
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Librería de Supabase (versión fija): primero la copia guardada.
  if (url.href === SUPABASE_JS) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
    return;
  }

  // Cualquier otro dominio (Supabase API, etc.): directo a la red.
  if (url.origin !== self.location.origin) return;

  // Archivos propios: primero la red para recibir los cambios de Vercel;
  // sin conexión, la copia guardada.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then(
          (r) => r || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())
        )
      )
  );
});
