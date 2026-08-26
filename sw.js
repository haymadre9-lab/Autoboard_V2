const C='teslanav-v61';
const ASSETS=['./','./index.html','./config.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-180.png','./radares.json'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin) return;              // mapa/APIs: red directa
  if(e.request.mode==='navigate' || u.pathname.endsWith('.html') || u.pathname.endsWith('/')){
    e.respondWith(fetch(e.request).then(r=>{ const cp=r.clone(); caches.open(C).then(c=>c.put(e.request,cp)); return r; }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
