const STATIC_CACHE = 'debtcontrol-static-v6.0.0';
const DYNAMIC_CACHE = 'debtcontrol-dynamic-v6.0.0';

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

// CDNs permitidos para cache offline (jsPDF, etc.)
const CACHEABLE_CDNS = [
  'cdnjs.cloudflare.com'
];

// Instalar: cachear archivos pero NO activar inmediatamente
// (permite que el banner de actualización funcione correctamente)
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando v6.0.0...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

// Activar: limpiar caches antiguos
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando...');
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

// Interceptar peticiones (solo mismo origen)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Cachear recursos de CDNs conocidos (jsPDF, etc.)
  if (CACHEABLE_CDNS.some((cdn) => url.hostname === cdn)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin !== location.origin) return;

  if (request.destination === 'document') {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

// Cache First para assets
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return caches.match('./index.html');
  }
}

// Network First para HTML
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    return cached || caches.match('./index.html');
  }
}

// Solo activar nueva versión cuando el usuario lo pida (via banner)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
