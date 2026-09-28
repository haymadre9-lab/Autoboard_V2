/* Service worker de AutoBoard.
   - Reescrito para el conjunto de archivos del motor Leaflet (antes cacheaba
     index.html/hud2-boot.js/faro/index.html del AutoBoard con MapLibre, que
     ya no existen). Nombre de cache subido a v8-0 para que el cambio de
     motor no herede nada de la cache anterior.
   - HTML y JS: red primero, cache como respaldo. Asi cada subida llega al
     momento y la app sigue abriendo sin conexion.
   - Teselas de mapa y APIs externas: NO se cachean aqui (las gestiona el
     navegador y Leaflet; cachearlas llenaba el almacenamiento del Tesla).  */
const C='autoboard-v8-0';
const BASE=['./','./index.html','./leaflet-map.js','./leaflet-map.css','./hud2.js','./coche.png','./radares.json','./manifest.webmanifest'];

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
