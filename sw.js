const CACHE_NAME = 'debtcontrol-v2.6.0';
const STATIC_CACHE = 'debtcontrol-static-v2.6.0';
const DYNAMIC_CACHE = 'debtcontrol-dynamic-v2.6.0';

// Archivos esenciales para cachear (incluye los assets del build)
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './site-guard.js',
  './cloud-sync.js',
  './assets/index-Bwgcmo9Q.js',
  './assets/vendor-B-V5UcMf.js',
  './assets/charts-BiLyBmV-.js',
  './assets/index-BVK2nLKa.css',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Instalar Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Cacheando archivos estáticos...');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activar Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando Service Worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
          .map((name) => {
            console.log('[SW] Eliminando cache antiguo:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptar peticiones
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo manejar peticiones del mismo origen
  if (url.origin !== location.origin) {
    return;
  }

  // Estrategia: Cache First para assets, Network First para HTML
  if (request.destination === 'document') {
    // Network First para documentos HTML
    event.respondWith(networkFirst(request));
  } else {
    // Cache First para assets (JS, CSS, imágenes)
    event.respondWith(cacheFirst(request));
  }
});

// Estrategia Cache First
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Error en fetch:', error);
    // Retornar página offline si existe
    return caches.match('./index.html');
  }
}

// Estrategia Network First
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Offline, sirviendo desde cache');
    const cachedResponse = await caches.match(request);
    return cachedResponse || caches.match('./index.html');
  }
}

// Escuchar mensajes
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
