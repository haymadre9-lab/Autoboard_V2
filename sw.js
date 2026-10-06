/* Service worker de AutoBoard.
   - Motor de mapa MapLibre GL AUTOALOJADO (maplibre-gl.js/css en esta carpeta, cacheados
     para funcionar sin conexion). Cache subida a v9-0 para no heredar nada del motor Leaflet.
   - HTML y JS: red primero, cache como respaldo. Asi cada subida llega al
     momento y la app sigue abriendo sin conexion.
   - Teselas de mapa y APIs externas: NO se cachean aqui (las gestiona el
     navegador; cachearlas llenaba el almacenamiento del Tesla).  */
const C='autoboard-v9-1';
const BASE=['./','./index.html','./maplibre-map.js','./maplibre-map.css','./maplibre-gl.js','./maplibre-gl.css','./hud2.js','./coche.png','./radares.json','./senales.json','./manifest.webmanifest'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(C).then(c=>Promise.all(BASE.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C && k.indexOf('autoboard')===0).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET' || u.origin!==location.origin) return;   // externo: sin tocar
  e.respondWith(
    fetch(e.request).then(r=>{
      if(r && r.ok){ const cp=r.clone(); caches.open(C).then(c=>c.put(e.request,cp)); }
      return r;
    }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html')))
  );
});
