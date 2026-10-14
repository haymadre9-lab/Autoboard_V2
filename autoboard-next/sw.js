/* Service worker mínimo: hace la app instalable y la abre aunque no haya red.
   Red primero (siempre carga la última versión de index.html); caché solo como respaldo. Teselas y APIs no se tocan. */
const V = 'autoboard-v131';
const BASE = ['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(BASE)).catch(()=>{})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;      /* solo archivos propios */
  if (/\.glb$|catalogo\.json$/.test(r.url)) return;                                  /* modelos: dejar al navegador */
  e.respondWith(fetch(r).then(res => { if(res.ok){ const cp=res.clone(); caches.open(V).then(c=>c.put(r,cp)).catch(()=>{}); } return res; }).catch(()=>caches.match(r).then(m=>m||caches.match('./index.html'))));
});
