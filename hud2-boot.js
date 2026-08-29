/**
 * hud2-boot.js — arranque de una línea para autoboardV2.
 *
 * En tu index.html, antes de </body>:
 *     <script type="module" src="./hud2-boot.js"></script>
 *
 * Crea el canvas, el botón "HUD 2" y expone window.hud2.
 * Desde tu código de mapa:
 *     window.hud2.setRoute(latlngs);   // al calcular o recalcular ruta
 *     window.hud2.setSpeed(mps);       // en cada posición
 *     window.hud2.syncPosition(lat,lng);
 *
 * Si no le pasas ruta, arranca con una de ejemplo para que veas que funciona.
 */
import { createHud2 } from './hud2.js';

const CSS = `
#hud2-wrap{position:fixed;inset:0;z-index:9000;display:none;background:#0a0d10}
#hud2-wrap.on{display:block}
#hud2-canvas{display:block;width:100%;height:100%}
#hud2-btn{position:fixed;right:14px;bottom:14px;z-index:9100;
  background:rgba(10,13,16,.82);border:1px solid #2c3942;color:#5fd0e0;
  font:600 12px/1 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
  letter-spacing:.12em;text-transform:uppercase;padding:12px 16px;border-radius:6px;
  cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
#hud2-btn.on{background:#5fd0e0;color:#06131a;border-color:#5fd0e0}
#hud2-err{position:fixed;left:14px;right:14px;top:14px;z-index:9200;display:none;
  background:rgba(255,90,77,.16);border:1px solid #ff5a4d;color:#ffd9d5;
  padding:10px 12px;border-radius:5px;font:12px/1.5 ui-monospace,monospace}
#hud2-fps{position:fixed;left:14px;top:14px;z-index:9100;display:none;
  color:#7b8b96;font:11px/1 ui-sans-serif,sans-serif;letter-spacing:.16em;text-transform:uppercase}
#hud2-wrap.on ~ #hud2-fps{display:block}
`;

function boot(){
  if (document.getElementById('hud2-btn')) return;         // no duplicar

  const st = document.createElement('style'); st.textContent = CSS;
  document.head.appendChild(st);

  const wrap = document.createElement('div'); wrap.id = 'hud2-wrap';
  const cv = document.createElement('canvas'); cv.id = 'hud2-canvas';
  wrap.appendChild(cv);
  const btn = document.createElement('button'); btn.id = 'hud2-btn'; btn.textContent = 'HUD 2';
  const err = document.createElement('div'); err.id = 'hud2-err';
  const fps = document.createElement('div'); fps.id = 'hud2-fps';
  document.body.append(wrap, btn, err, fps);

  // MISMA clave que hud2.html: los ajustes que afinaste en el coche se heredan aquí.
  const HUD2_KEY = 'hud2.cfg';
  const HUD2_DEF = { theme:'auto', maxFps:0, beamReach:34, fogEnd:260,
                     lookAhead:55, camHeight:2.6, camBack:7.5, posts:true };
  let cfg;
  try { cfg = Object.assign({}, HUD2_DEF, JSON.parse(localStorage.getItem(HUD2_KEY) || '{}')); }
  catch(e){ cfg = Object.assign({}, HUD2_DEF); }

  const hud = createHud2(cv, cfg);
  hud.onError = e => { err.style.display = 'block'; err.textContent = 'hud2: ' + e.message; };

  // ruta de ejemplo, solo hasta que tu app llame a setRoute
  let rutaPropia = false;
  const R = 6378137, LAT0 = 43.30, LNG0 = -3.05, c0 = Math.cos(LAT0*Math.PI/180);
  const toLL = (x,z) => [LAT0 + z/R*180/Math.PI, LNG0 + x/(R*c0)*180/Math.PI];
  const demo = []; let x = 0, z = 0, h = 0;
  for (let i=0;i<500;i++){ z += 2; demo.push(toLL(x,z)); }
  for (let i=0;i<44;i++){ h -= 2/16; x += Math.sin(h)*2; z += Math.cos(h)*2; demo.push(toLL(x,z)); }
  for (let i=0;i<700;i++){ h += 0.0018*Math.sin(i/40)*2; x += Math.sin(h)*2; z += Math.cos(h)*2; demo.push(toLL(x,z)); }
  // Si ya cargaste un trazado en hud2.html, se reutiliza: mismo origen, mismo
  // localStorage. Así el botón HUD 2 muestra tu ruta y no la de ejemplo.
  let inicial = demo;
  try {
    const g = JSON.parse(localStorage.getItem('hud2.ruta') || 'null');
    if (g && g.length > 3) inicial = g;
  } catch(e){}
  try { hud.setRoute(inicial); hud.setSpeed(22); } catch(e){ hud.onError(e); }

  // API pública, envolviendo setRoute para saber si ya hay ruta real
  window.hud2 = Object.assign(Object.create(hud), {
    setRoute(ll, o){ rutaPropia = true;
      try { localStorage.setItem('hud2.ruta', JSON.stringify(ll)); } catch(e){}
      return hud.setRoute(ll, o); },
    abrir(){ activar(true); }, cerrar(){ activar(false); },
    get demoActiva(){ return !rutaPropia; },
    // ajustes persistentes, compartidos con hud2.html
    ajustes(){ return Object.assign({}, cfg); },
    ajustar(o){ Object.assign(cfg, o); hud.set(cfg);
      try { localStorage.setItem(HUD2_KEY, JSON.stringify(cfg)); } catch(e){} }
  });

  // contador de fps: la cifra que decide si esto aguanta en la pantalla del coche
  let n = 0, t0 = performance.now();
  (function tick(){
    requestAnimationFrame(tick);
    n++;
    const now = performance.now();
    if (now - t0 > 500){ fps.textContent = 'HUD 2 · ' + Math.round(n/(now-t0)*1000) + ' fps'; n = 0; t0 = now; }
  })();

  function activar(on){
    wrap.classList.toggle('on', on);
    btn.classList.toggle('on', on);
    fps.style.display = on ? 'block' : 'none';
    if (on){ hud.resize(); hud.start(); } else hud.stop();
  }
  btn.onclick = () => activar(!wrap.classList.contains('on'));
  window.addEventListener('orientationchange', () => setTimeout(hud.resize, 250));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
