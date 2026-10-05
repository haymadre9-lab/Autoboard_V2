/* Service worker de la prueba MapLibre (carpeta maplibre-test/).
   - HTML y JS: red primero, cache como respaldo (cada subida llega al momento y abre sin conexion).
   - MapLibre (JS y CSS) va AUTOALOJADO en esta carpeta, asi tambien funciona sin conexion.
   - Teselas y APIs externas: NO se cachean aqui (cachearlas llenaba el almacenamiento del Tesla).
   - Cache propia 'autoboard-ml-v1': solo borra caches 'autoboard-ml-*' antiguas. OJO: el SW de la
     raiz borra TODAS las que empiezan por 'autoboard' que no sean la suya, asi que si la app de la
     raiz se actualiza puede vaciar esta cache; no es grave (red primero), solo pierde el respaldo offline. */
const C = 'autoboard-ml-v1';
const BASE = ['./', './index.html', './maplibre-map.js', './maplibre-map.css', './maplibre-gl.js', './maplibre-gl.css',
              '../hud2.js', '../radares.json', '../coche.png', '../manifest.webmanifest'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => Promise.all(BASE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C && k.indexOf('autoboard-ml-') === 0).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // externo: sin tocar
  e.respondWith(
    fetch(e.request).then(r => {
      if (r && r.ok){ const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
