/**
 * hud2.js — cinta de carretera 3D para autoboardV2. Canvas 2D, sin dependencias.
 *
 * Es DECORATIVO: la fuente de verdad sigue siendo el mapa. Aquí no hay mapa,
 * ni tiles, ni cálculo de ruta. Solo geometría de la ruta que ya tienes.
 *
 *   import { createHud2 } from './hud2.js';
 *   const hud = createHud2(document.getElementById('hud2'));
 *   hud.setRoute(latlngs);            // [[lat,lng], ...] de tu ruta
 *   hud.setSpeed(mps);                // cada vez que llegue una posición
 *   hud.syncPosition(lat, lng);       // opcional pero recomendado (ver abajo)
 *   hud.start();
 *
 * Entre posiciones GPS el avance se integra con la velocidad, así que la cinta
 * va suave a 60 fps aunque el receptor dé 1 Hz. syncPosition() corrige la deriva.
 */

const STEP = 2;          // remuestreo de la ruta, en metros
const LANE = 3.6;

const PAL = {
  day:   { skyTop:'#7fa6c4', skyBot:'#cfdbe2', ground:'#5c6a5a', asphalt:[60,64,68], line:[228,230,224], glow:0 },
  dusk:  { skyTop:'#2b3550', skyBot:'#c9764a', ground:'#3a3a38', asphalt:[44,44,48], line:[214,200,176], glow:.45 },
  night: { skyTop:'#05070c', skyBot:'#141c28', ground:'#12161a', asphalt:[26,28,32], line:[190,196,190], glow:1 }
};

// Perfil de la carrocería: z_local (+ = hacia delante), semiancho, altura de
// cintura, semiancho de techo, altura de techo. Ajústalo a tu coche si quieres.
const PROF = [
  // Proporciones de un sedán fastback tamaño Model 3: 4,69 m de largo, 1,85 de
  // ancho, 1,44 de alto, 2,88 de batalla. Techo con caída continua desde el
  // vértice hasta el portón — eso es lo que da la silueta, no los detalles.
  // z_local (+ = hacia delante), semiancho, altura de cintura, semiancho de techo, altura de techo
  [-2.347, 0.800, 0.950, 0.000, 1.020],
  [-2.150, 0.875, 0.970, 0.000, 1.062],
  [-1.900, 0.905, 0.990, 0.150, 1.125],
  [-1.600, 0.920, 1.000, 0.305, 1.212],
  [-1.250, 0.925, 1.005, 0.520, 1.300],
  [-0.850, 0.925, 1.000, 0.660, 1.386],
  [-0.450, 0.925, 0.990, 0.710, 1.428],
  [-0.050, 0.925, 0.980, 0.722, 1.443],
  [ 0.350, 0.923, 0.975, 0.712, 1.437],
  [ 0.750, 0.918, 0.970, 0.672, 1.400],
  [ 1.100, 0.910, 0.960, 0.560, 1.330],
  [ 1.450, 0.895, 0.950, 0.300, 1.218],
  [ 1.750, 0.875, 0.930, 0.000, 1.098],
  [ 2.000, 0.845, 0.900, 0.000, 0.990],
  [ 2.200, 0.805, 0.870, 0.000, 0.928],
  [ 2.347, 0.745, 0.840, 0.000, 0.880]
];
const LIGHT = (() => { const v=[0.32,0.86,-0.40], L=Math.hypot(v[0],v[1],v[2]); return v.map(k=>k/L); })();

const _hexCache = {};
const hexToRgb = h => _hexCache[h] || (_hexCache[h] =
  (n => [n>>16&255, n>>8&255, n&255])(parseInt(h.slice(1),16)));
// mixc se llamaba ~600 veces por frame y cada una creaba una cadena nueva:
// mucha basura para el recolector. Se cachea cuantizando el color y la niebla.
const _mixCache = new Map();
const mixc = (c,t,f) => {
  const q = (f*24)|0;
  const key = ((c[0]|0)<<24 ^ (c[1]|0)<<16 ^ (c[2]|0)<<8 ^ q) + ':' + ((t[0]|0)<<8 ^ (t[1]|0)<<4 ^ (t[2]|0));
  let v = _mixCache.get(key);
  if (v !== undefined) return v;
  const g = q/24;
  v = 'rgb(' + Math.round(c[0]+(t[0]-c[0])*g) + ',' + Math.round(c[1]+(t[1]-c[1])*g)
      + ',' + Math.round(c[2]+(t[2]-c[2])*g) + ')';
  if (_mixCache.size > 6000) _mixCache.clear();
  _mixCache.set(key, v);
  return v;
};
const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
const smooth = x => x*x*(3-2*x);

export function createHud2(canvas, opts = {}){
  const ctx = canvas.getContext('2d');
  const cfgOpt = Object.assign({
    theme: 'auto',          // 'auto' | 'day' | 'dusk' | 'night'
    beamReach: 34,          // alcance del haz en metros
    fogEnd: 260,            // distancia de niebla
    lookAhead: 55,          // look-ahead base de la cámara
    camHeight: 2.6,
    camBack: 7.5,
    horizon: 0.50,          // centro vertical del encuadre: <0.5 sube la escena
    posts: true,            // farolas y quitamiedos
    carColor: '#eef1f4',    // blanco perla; se puede cambiar desde Ajustes
    carScale: 1.0,          // tamaño del coche, 0.6 a 1.6
    hudScale: 1.0,          // tamaño de los textos del HUD
    maxFps: 0,              // 0 = libre
    escala: 1.0,            // resolucion de render: 0.5 = la mitad de pixeles por lado
    perfil: 'auto',         // 'auto' | 'ligero' | 'completo'
    frenarCamara: false,    // limitar look-ahead en curva cerrada (mantiene el
                            // coche en cuadro, pero resta sensación de giro)
    detalleCoche: true,     // zócalo, pasos de rueda, retrovisores, montantes
    hud: true,              // superponer maniobra, velocidad y limite
    carteles: true,         // señales de dirección dentro de la escena
    carPhoto: null,         // dataURL de tu coche recortado; null = coche dibujado
    rbRadius: 45,           // radio maximo para considerar rotonda, en metros
    rbArc: 18,              // metros minimos de curva sostenida
    rbSmooth: 1,            // pasadas de suavizado del rumbo (mas = aplana rotondas)
    rain: false,            // lluvia en pantalla
    spray: true,            // agua levantada por las ruedas (solo con lluvia)
    traffic: 'off'          // 'off' | 'poca' | 'normal' | 'mucha'
  }, opts);

  let W = 0, H = 0, dpr = 1;
  let pts = null, N = 0, routeLen = 0;     // ruta remuestreada: x, z, rumbo
  let RB = [], MW = [];                    // rotondas detectadas, tramos de autovía
  let s = 0, speed = 0, targetSpeed = 0, brake = 0, prevSpeed = 0;
  let running = false, raf = 0, last = 0, lastDraw = 0, frameN = 0;
  let origin = null;                       // [lat, lng] del primer punto
  const api = {};
  api.onError = null;
  api.version = '2026.08.31-5';   // sube al cambiar: sirve para saber qué está corriendo
  let carImg = null, carAR = 1;
  let manOver = null, limitOver = null, radarOver = null, streetOver = null;
  let fuera = 0;
  api.onFueraDeRuta = null;
  api.fueraDeRuta = () => fuera >= 6;
  let manList = [], limList = [], radList = [];

  /** Carga la foto desde una URL del propio repo: no hace falta USB en el coche. */
  api.setCarPhotoUrl = function(url){
    if (!url){ api.setCarPhoto(null); return; }
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => { carImg = im; carAR = im.naturalHeight/im.naturalWidth; cfgOpt.carPhoto = url; };
    im.onerror = () => { if (api.onError) api.onError(new Error('no se pudo cargar ' + url)); };
    im.src = url;
  };

  /** Foto del coche ya recortada (dataURL PNG con alfa). null vuelve al dibujado. */
  api.setCarPhoto = function(url){
    if (!url){ carImg = null; cfgOpt.carPhoto = null; return; }
    const im = new Image();
    im.onload = () => { carImg = im; carAR = im.naturalHeight/im.naturalWidth; };
    im.onerror = () => { carImg = null; if (api.onError) api.onError(new Error('foto no válida')); };
    im.src = url; cfgOpt.carPhoto = url;
  };
  /**
   * Lista completa de maniobras, UNA llamada por ruta. Cada una:
   *   { metro, tipo:'left'|'right'|'straight'|'roundabout', calle, salida }
   * 'metro' es la distancia desde el inicio de la ruta. El HUD hace la cuenta
   * atrás solo, así que no hay que refrescar nada en cada posición.
   * Desde OSRM: acumula step.distance y usa step.maneuver.modifier / .type.
   */
  api.setManeuvers = function(list){
    manList = (list || []).filter(m => m && isFinite(m.metro)).sort((a,b) => a.metro - b.metro);
    return manList.length;
  };
  /** Maniobra suelta. Con 'metro' cuenta atrás sola; con 'dist' se fija ahora. */
  api.setManeuver = m => {
    if (!m){ manList = []; manOver = null; return; }
    manOver = null;
    manList = [Object.assign({}, m, { metro: m.metro !== undefined ? m.metro : s + (m.dist||0) })];
  };
  /** Límites por tramo: [{metro, kmh}, ...]. Vale el de la última entrada pasada. */
  api.setLimits = l => { limList = (l||[]).filter(x => isFinite(x.metro)).sort((a,b)=>a.metro-b.metro); };
  api.setLimit = k => { limitOver = k; };
  api.setStreet = s2 => { streetOver = s2; };
  api.setRadar = m => { radarOver = m; };

  /**
   * Radares en coordenadas, tal cual los tienes en radares.json. Se proyectan
   * sobre la ruta y solo se quedan los que caen a menos de `margen` metros:
   * el resto están en otras carreteras y no te afectan.
   */
  api.setRadars = function(puntos, margen){
    margen = margen || 45;
    radList = [];
    if (!pts || !origin || !puntos || !puntos.length) return 0;
    const lat0 = origin[0]*Math.PI/180, RT = 6378137;
    // Rejilla de 120 m: sin ella, 300 radares por una ruta de 96 km son 14
    // millones de comparaciones y se nota como un tirón al calcular ruta.
    const CELL = 120, grid = new Map();
    const key = (a,b) => a + ',' + b;
    for (let i = 0; i < N; i++){
      const k = key(Math.floor(pts[i*3]/CELL), Math.floor(pts[i*3+1]/CELL));
      let arr = grid.get(k); if (!arr){ arr = []; grid.set(k, arr); }
      arr.push(i);
    }
    for (const p of puntos){
      const lat = p.lat !== undefined ? p.lat : (Array.isArray(p) ? p[0] : (p.latitude !== undefined ? p.latitude : p.y));
      const lng = p.lng !== undefined ? p.lng : (Array.isArray(p) ? p[1] : (p.longitude !== undefined ? p.longitude : (p.lon !== undefined ? p.lon : p.x)));
      if (!isFinite(lat) || !isFinite(lng)) continue;
      const px = RT*(lng-origin[1])*Math.PI/180*Math.cos(lat0);
      const pz = RT*(lat-origin[0])*Math.PI/180;
      const cx = Math.floor(px/CELL), cz = Math.floor(pz/CELL);
      let best = -1, bd = Infinity;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++){
        const arr = grid.get(key(cx+a, cz+b)); if (!arr) continue;
        for (const i of arr){
          const d = (pts[i*3]-px)**2 + (pts[i*3+1]-pz)**2;
          if (d < bd){ bd = d; best = i; }
        }
      }
      if (best >= 0 && Math.sqrt(bd) <= margen)
        radList.push({ metro: best*STEP,
                       kmh: p.kmh || p.speed || p.velocidad || p.limite || null });
    }
    radList.sort((a,b) => a.metro - b.metro);
    // dos radares a menos de 60 m son el mismo punto duplicado
    radList = radList.filter((r,i) => i === 0 || r.metro - radList[i-1].metro > 60);
    return radList.length;
  };

  /* ---------------- geometría de la ruta ---------------- */

  // Fuera de los extremos se EXTRAPOLA en línea recta, no se recorta. Recortando,
  // en el metro 0 la cámara (que va detrás) caía dentro del coche y este
  // desaparecía tras el plano de recorte: sólo se veían los faros.
  function at(t){
    if (!pts) return { x:0, z:0, h:0 };
    if (t < 0){
      const h = pts[2];
      return { x: pts[0] + Math.sin(h)*t, z: pts[1] + Math.cos(h)*t, h };
    }
    const fin = routeLen - 1;
    if (t > fin){
      const k = (N-1)*3, h = pts[k+2], d = t - fin;
      return { x: pts[k] + Math.sin(h)*d, z: pts[k+1] + Math.cos(h)*d, h };
    }
    const i = (t/STEP)|0, f = (t - i*STEP)/STEP, j = Math.min(i+1, N-1);
    const ax=pts[i*3], az=pts[i*3+1], ah=pts[i*3+2];
    return { x: ax + (pts[j*3]-ax)*f, z: az + (pts[j*3+1]-az)*f, h: ah + (pts[j*3+2]-ah)*f };
  }
  const normalAt = t => { const h = at(t).h; return { x: Math.cos(h), z: -Math.sin(h) }; };
  // Ventana corta: con +-6 m una rotonda de 15 m de radio se promediaba
  // hasta desaparecer. Con +-3.5 m se conserva.
  const curv = t => (at(t+3.5).h - at(t-3.5).h) / 7;

  // Una polilínea desplazada se pliega si el desplazamiento hacia el interior
  // supera el radio. Aquí se limita al 72% para que nunca se cruce sobre sí misma.
  function safeOff(t, off){
    const k = curv(t);
    if (Math.abs(k) < 1e-5) return off;
    const R = 1/Math.abs(k), inside = Math.sign(k);
    return (Math.sign(off) === inside && Math.abs(off) > R*0.72) ? inside*R*0.72 : off;
  }
  const ptOff = (t, off, y) => {
    const p = at(t), n = normalAt(t), o = safeOff(t, off);
    return { x: p.x + n.x*o, y: y || 0, z: p.z + n.z*o };
  };

  function rbFactor(t){
    let f = 0;
    for (const r of RB){
      if (t > r.s0 - 70 && t < r.s1 + 70){
        const inn = Math.min((t-(r.s0-70))/70, ((r.s1+70)-t)/70, 1);
        f = Math.max(f, clamp(inn, 0, 1));
      }
    }
    return smooth(f);
  }
  function mwFactor(t){
    let f = 0;
    for (const g of MW){
      if (t > g[0]-160 && t < g[1]+160){
        const inn = Math.min((t-(g[0]-160))/160, ((g[1]+160)-t)/160, 1);
        f = Math.max(f, smooth(clamp(inn, 0, 1)));
      }
    }
    return f;
  }
  // Perfil transversal interpolado: convencional -> autovía con mediana.
  const xsCache = new Map();
  function xsec(t){
    const key = (t/4)|0;
    const hit = xsCache.get(key);
    if (hit !== undefined) return hit;
    const v = xsecCalc(key*4);
    if (xsCache.size > 4000) xsCache.clear();
    xsCache.set(key, v);
    return v;
  }
  function xsecCalc(t){
    const rf = rbFactor(t), f = mwFactor(t) * (1 - rf);
    return { f, rf,
      med:  f*1.7,
      half: (3.5 + f*(1.7 + 2*LANE - 3.5))*(1-rf) + 4.9*rf,
      mine: (1.75 + f*(1.7 + LANE*1.5 - 1.75))*(1-rf) + 2.5*rf };
  }
  const myOffset = t => { const c = xsec(t); return clamp(c.mine, c.med + 1.15, c.half - 1.15); };

  /* ---------------- carga de ruta ---------------- */

  function toLocal(ll){
    const lat0 = ll[0][0]*Math.PI/180, R = 6378137;
    return ll.map(p => ({
      x: R * (p[1]-ll[0][1])*Math.PI/180 * Math.cos(lat0),
      z: R * (p[0]-ll[0][0])*Math.PI/180
    }));
  }

  /**
   * @param {Array<[number,number]>} latlngs  puntos [lat, lng] de la ruta
   * @param {Object} [o]  { motorway: [[m0,m1], ...] } tramos de autovía en metros
   */
  api.setRoute = function(latlngs, o = {}){
    if (!latlngs || latlngs.length < 3) throw new Error('hacen falta al menos 3 puntos');
    origin = latlngs[0];
    if (solLat === null){ solLat = origin[0]; solLng = origin[1]; }
    const raw = toLocal(latlngs);

    // Remuestreo uniforme. Los vértices de OSM son irregulares y sin esto la
    // curvatura da picos donde solo hay vértices juntos.
    const samp = [raw[0]]; let carry = 0;
    for (let i = 1; i < raw.length; i++){
      const dx = raw[i].x - raw[i-1].x, dz = raw[i].z - raw[i-1].z;
      const seg = Math.hypot(dx, dz);
      if (seg < 1e-6) continue;
      let d = STEP - carry;
      while (d <= seg){ samp.push({ x: raw[i-1].x + dx*d/seg, z: raw[i-1].z + dz*d/seg }); d += STEP; }
      carry = seg - (d - STEP);
    }
    if (samp.length < 8) throw new Error('trazado demasiado corto');

    N = samp.length; routeLen = (N-1)*STEP;
    pts = new Float32Array(N*3);
    for (let i = 0; i < N; i++){
      const a = samp[Math.max(i-1,0)], b = samp[Math.min(i+1,N-1)];
      let h = Math.atan2(b.x-a.x, b.z-a.z);
      if (i > 0){                                  // desenrollar: sin esto salta en ±π
        const prev = pts[(i-1)*3+2];
        while (h - prev >  Math.PI) h -= 2*Math.PI;
        while (h - prev < -Math.PI) h += 2*Math.PI;
      }
      pts[i*3] = samp[i].x; pts[i*3+1] = samp[i].z; pts[i*3+2] = h;
    }
    // Suavizado del rumbo. Quita el temblor de los vertices de OSM, pero cada
    // pasada tambien aplana las rotondas: por eso es configurable.
    for (let p = 0; p < cfgOpt.rbSmooth; p++)
      for (let i = 1; i < N-1; i++)
        pts[i*3+2] = pts[i*3+2]*0.5 + (pts[(i-1)*3+2] + pts[(i+1)*3+2])*0.25;
    // Pasada extra SOLO donde la curvatura es alta: redondea rotondas y giros
    // cerrados sin aplanar las curvas largas de carretera abierta.
    for (let p = 0; p < 3; p++)
      for (let i = 2; i < N-2; i++){
        const k = Math.abs(pts[(i+1)*3+2] - pts[(i-1)*3+2]) / (2*STEP);
        if (k > 0.020)
          pts[i*3+2] = pts[i*3+2]*0.34
                     + (pts[(i-1)*3+2] + pts[(i+1)*3+2])*0.24
                     + (pts[(i-2)*3+2] + pts[(i+2)*3+2])*0.09;
      }

    MW = o.motorway || [];
    RB = detectRoundabouts();
    manList = []; limList = []; radList = []; xsCache.clear();
    fuera = 0; cam0.off = null;
    s = Math.min(6, routeLen*0.02);
    return { metros: Math.round(routeLen), puntos: N, rotondas: RB.length };
  };

  // Rotonda = curvatura sostenida con radio pequeño. Dos criterios, basta uno:
  //   a) arco largo con radio bajo (rotonda grande recorrida a medias)
  //   b) cambio de rumbo acumulado grande (rotonda pequeña, pocos metros)
  // Los tramos con huecos cortos se fusionan: la geometría simplificada del
  // router parte una rotonda en dos trozos con un vértice recto en medio.
  function detectRoundabouts(){
    const KMIN = 1/cfgOpt.rbRadius, ARC = cfgOpt.rbArc;
    const runs = []; let run = null;
    for (let x = 4; x < routeLen - 4; x += 2){
      const k = curv(x);
      if (Math.abs(k) > KMIN){
        if (!run || Math.sign(k) !== run.sign || x - run.s1 > 20){
          run = { s0:x, sign:Math.sign(k), ks:[] }; runs.push(run);
        }
        run.s1 = x; run.ks.push(Math.abs(k));
      }
    }
    const out = [];
    for (const r of runs){
      const arc = r.s1 - r.s0;
      if (arc < 6) continue;
      const kAvg = r.ks.reduce((a,b)=>a+b,0)/r.ks.length;
      const giro = Math.abs(at(r.s1).h - at(r.s0).h);        // rumbo acumulado, rad
      if (!(arc >= ARC || giro > 1.6)) continue;
      if (giro < 0.9) continue;                              // una curva suave no lo es
      const R = 1/kAvg;
      const mid = (r.s0+r.s1)/2, p = at(mid), n = normalAt(mid);
      out.push({ s0:r.s0, s1:r.s1, R, giro,
                 cx: p.x + n.x*R*r.sign, cz: p.z + n.z*R*r.sign });
    }
    return out;
  }

  /** Lista de rotondas detectadas, para comparar con el mapa. */
  api.rotondas = () => RB.map(r => ({
    metro: Math.round(r.s0), largo: Math.round(r.s1-r.s0),
    radio: Math.round(r.R), grados: Math.round(r.giro*180/Math.PI) }));

  /** Vuelve a detectar tras cambiar rbRadius / rbArc. */
  api.redetectar = () => { if (pts) RB = detectRoundabouts(); return api.rotondas(); };

  /** Añade rotondas explícitas en metros de ruta, si las sacas de los steps. */
  api.setRoundabouts = function(ranges){
    RB = ranges.map(([a,b]) => {
      const mid = (a+b)/2, k = curv(mid) || 1/20, R = 1/Math.abs(k);
      const p = at(mid), n = normalAt(mid);
      return { s0:a, s1:b, R, cx: p.x + n.x*R*Math.sign(k), cz: p.z + n.z*R*Math.sign(k) };
    });
  };

  /* ---------------- posición ---------------- */

  api.setSpeed = mps => { targetSpeed = Math.max(0, mps || 0); };
  api.setProgress = m => { s = clamp(m, 0, routeLen - 1); };

  /**
   * Corrección de deriva. Proyecta lat/lng sobre la ruta buscando solo en una
   * ventana alrededor de la s actual, para no saltar a otro tramo que pase cerca.
   * Llámalo con cada posición del GPS. Si te has salido de la ruta devuelve null
   * y no toca nada: la cinta sigue mostrando la ruta original hasta que recalcules.
   */
  api.syncPosition = function(lat, lng, windowM = 120){
    if (!pts || !origin) return null;
    const lat0 = origin[0]*Math.PI/180, R = 6378137;
    const px = R*(lng-origin[1])*Math.PI/180*Math.cos(lat0);
    const pz = R*(lat-origin[0])*Math.PI/180;
    let best = null, bestD = Infinity;
    const i0 = Math.max(0, ((s-windowM)/STEP)|0), i1 = Math.min(N-1, ((s+windowM)/STEP)|0);
    for (let i = i0; i <= i1; i++){
      const d = (pts[i*3]-px)**2 + (pts[i*3+1]-pz)**2;
      if (d < bestD){ bestD = d; best = i; }
    }
    const desvio = Math.sqrt(bestD);
    if (best === null || desvio > 55){
      // Fuera de ruta. NO se corrige: forzar la posicion contra una ruta que ya
      // no sigues es lo que hace que el coche pegue saltos y aparezcan curvas
      // de la nada. Se avisa y se espera a que tu app recalcule.
      if (++fuera === 6 && api.onFueraDeRuta) { try { api.onFueraDeRuta(desvio); } catch(e){} }
      return null;
    }
    fuera = 0;
    const gpsS = best*STEP;
    // correccion suave y ACOTADA: como mucho 6 m por fix. Un salto grande del
    // receptor no puede teletransportar la escena.
    const dif = clamp((gpsS - s) * 0.18, -6, 6);
    s = clamp(s + dif, 0, routeLen - 1);
    return { s: gpsS, desvio: desvio, fuera: false };
  };

  /* ---------------- cámara y proyección ---------------- */

  const cam = {x:0,y:0,z:0}, fwd = {x:0,y:0,z:1}, rgt = {x:1,y:0,z:0}, upv = {x:0,y:1,z:0};
  let focal = 500;

  // Estado suavizado de la camara. Antes cada parametro saltaba al valor nuevo
  // en el mismo frame: al cambiar la velocidad o el ancho de calzada, la escena
  // pegaba un tiron (zoom repentino, coche cruzando de lado a lado).
  const cam0 = { off:null, fov:44, hgt:2.6, back:7.5, look:20 };
  let dtCam = 0.016;

  function setupCamera(){
    const t = Math.min(speed*3.6/130, 1);
    const offObj = myOffset(s);
    // el desplazamiento lateral se persigue, no se copia: 2.5 m/s como mucho
    if (cam0.off === null) cam0.off = offObj;
    else {
      const dmax = 2.5*dtCam;
      const dif = clamp(offObj - cam0.off, -dmax, dmax);
      cam0.off += dif;
    }
    const off = cam0.off;
    // El acoplamiento con la velocidad es lo que da la sensación de avance:
    // más FOV, cámara más baja, y mirando mucho más lejos al acelerar.
    let fovDeg = 44 + t*20;
    let height = cfgOpt.camHeight * (1 - t*0.22);
    let back   = cfgOpt.camBack * (1 + t*0.30);
    let lookM  = 20 + cfgOpt.lookAhead*t;
    // En curva cerrada la distancia se recorre girando, así que la cámara puede
    // acabar mirando hacia atrás y el coche sale de cuadro. Limitarlo lo evita,
    // pero mata la sensación de giro: por eso está desactivado por defecto.
    if (cfgOpt.frenarCamara){
      const k = Math.abs(curv(s));
      if (k > 1e-4){ lookM = Math.min(lookM, 0.85/k); back = Math.min(back, 0.30/k); }
    }
    // suavizado exponencial de los cuatro parametros
    const k = Math.min(dtCam*2.2, 1);
    cam0.fov  += (fovDeg - cam0.fov)*k;
    cam0.hgt  += (height - cam0.hgt)*k;
    cam0.back += (back   - cam0.back)*k;
    cam0.look += (lookM  - cam0.look)*Math.min(dtCam*1.4, 1);
    fovDeg = cam0.fov; height = cam0.hgt; back = cam0.back; lookM = cam0.look;

    const c = ptOff(s - back, off, height);
    const g = ptOff(s + lookM, off*0.5, height*0.42);
    cam.x=c.x; cam.y=c.y; cam.z=c.z;
    let dx=g.x-cam.x, dy=g.y-cam.y, dz=g.z-cam.z;
    const L = Math.hypot(dx,dy,dz) || 1;
    fwd.x=dx/L; fwd.y=dy/L; fwd.z=dz/L;
    const rl = Math.hypot(fwd.z, fwd.x) || 1;
    rgt.x=fwd.z/rl; rgt.y=0; rgt.z=-fwd.x/rl;
    upv.x = fwd.y*rgt.z - fwd.z*rgt.y;
    upv.y = fwd.z*rgt.x - fwd.x*rgt.z;
    upv.z = fwd.x*rgt.y - fwd.y*rgt.x;
    focal = (H/2) / Math.tan((fovDeg*Math.PI/180)/2);
    cfgOpt.__off = off;
  }

  const P0 = {x:0,y:0,d:0,ok:false};
  function project(p){
    const dx=p.x-cam.x, dy=p.y-cam.y, dz=p.z-cam.z;
    const zc = dx*fwd.x + dy*fwd.y + dz*fwd.z;
    if (zc < 0.45){ P0.ok = false; return P0; }
    P0.x = W/2 + (dx*rgt.x + dy*rgt.y + dz*rgt.z)*focal/zc;
    P0.y = H*cfgOpt.horizon - (dx*upv.x + dy*upv.y + dz*upv.z)*focal/zc;
    P0.d = zc; P0.ok = true;
    return P0;
  }
  // project() reutiliza un objeto: si necesitas dos resultados a la vez, copia.
  const projCopy = p => { const q = project(p); return {x:q.x, y:q.y, d:q.d, ok:q.ok}; };

  function poly(list, fill, sellar){
    const sc = [];
    for (const p of list){ const q = project(p); if (!q.ok) return false; sc.push(q.x, q.y); }
    ctx.beginPath(); ctx.moveTo(sc[0], sc[1]);
    for (let i = 2; i < sc.length; i += 2) ctx.lineTo(sc[i], sc[i+1]);
    ctx.closePath();
    if (fill){
      ctx.fillStyle = fill; ctx.fill();
      // Canvas antialiasa cada poligono por separado: entre dos caras contiguas
      // queda una linea de fondo de medio pixel. En la carroceria eso se ve como
      // un despiece de trozos sueltos. Repasando el borde con el MISMO color, las
      // caras se sellan y el coche se lee como una pieza.
      if (sellar){ ctx.strokeStyle = fill; ctx.lineWidth = 1.15; ctx.lineJoin = 'round'; ctx.stroke(); }
    }
    return true;
  }

  /* ---------------- dibujo ---------------- */

  // Altura del sol sobre el horizonte, en grados. Con esto el tema automático
  // funciona en diciembre igual que en junio: a las 18:30 en Bilbao ya es noche,
  // y un reloj con horas fijas no se entera.
  let solLat = null, solLng = null;
  api.setLatLng = (la, ln) => { solLat = la; solLng = ln; };
  function alturaSol(){
    if (solLat === null) return null;
    const d = new Date();
    const n = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
    const dec = 23.44 * Math.sin((360/365)*(n + 284) * Math.PI/180);
    const horaUTC = d.getUTCHours() + d.getUTCMinutes()/60;
    const horaSolar = horaUTC + solLng/15;
    const H = (horaSolar - 12) * 15;
    const r = Math.PI/180;
    return Math.asin(Math.sin(solLat*r)*Math.sin(dec*r)
                   + Math.cos(solLat*r)*Math.cos(dec*r)*Math.cos(H*r)) / r;
  }
  function palette(){
    if (cfgOpt.theme !== 'auto') return PAL[cfgOpt.theme] || PAL.day;
    const alt = alturaSol();
    if (alt !== null) return alt > 6 ? PAL.day : alt > -6 ? PAL.dusk : PAL.night;
    const h = new Date().getHours();          // sin posición, reloj como respaldo
    return (h >= 21 || h < 7) ? PAL.night : (h >= 19 || h < 8) ? PAL.dusk : PAL.day;
  }
  /** Qué tema está aplicando ahora mismo el modo automático. */
  api.temaActual = () => {
    const p = palette();
    return p === PAL.night ? 'night' : p === PAL.dusk ? 'dusk' : 'day';
  };

  let skyGrad = null, skyKey = '';
  function drawSky(pal){
    const key = pal.skyTop + H;
    if (key !== skyKey){                       // solo al cambiar tema o tamaño
      skyGrad = ctx.createLinearGradient(0,0,0,H);
      skyGrad.addColorStop(0, pal.skyTop); skyGrad.addColorStop(1, pal.skyBot);
      skyKey = key;
    }
    ctx.fillStyle = skyGrad; ctx.fillRect(0,0,W,H);
    const hz = projCopy({ x: cam.x + fwd.x*4000, y: 0, z: cam.z + fwd.z*4000 });
    const y = hz.ok ? hz.y : H*cfgOpt.horizon*0.9;
    ctx.fillStyle = pal.ground; ctx.fillRect(0, y, W, H-y);
  }

  function drawIsland(r, pal, fogRGB){
    const gr = hexToRgb(pal.ground), RR = r.R;
    const ring = (rad, y, col) => {
      const p = [];
      for (let k = 0; k < 26; k++){ const a = k/26*6.2832;
        p.push({ x: r.cx + Math.cos(a)*rad, y, z: r.cz + Math.sin(a)*rad }); }
      poly(p, col);
    };
    ring(Math.max(RR-4.4, 1.5), 0.02, mixc([198,200,196], fogRGB, .15));
    ring(Math.max(RR-4.9, 1.2), 0.16, mixc(gr, fogRGB, .10));
    ring(Math.max(RR-7.5, 0.8), 0.55, mixc([gr[0]*1.15, gr[1]*1.2, gr[2]*1.1], fogRGB, .10));
    poly([{x:r.cx-0.16,y:0.55,z:r.cz},{x:r.cx+0.16,y:0.55,z:r.cz},
          {x:r.cx+0.16,y:6.2,z:r.cz},{x:r.cx-0.16,y:6.2,z:r.cz}], mixc([120,126,132], fogRGB, .2));
  }

  function drawRoad(pal){
    const fogRGB = hexToRgb(pal.skyBot), groundRGB = hexToRgb(pal.ground), fogEnd = cfgOpt.fogEnd;
    const lig = ligero();
    const SEGb = lig ? 7 : 4, FAR = Math.min(fogEnd + 40, lig ? 300 : 620);
    // Segmento adaptativo: donde la carretera es recta no hace falta trocearla,
    // y en curva cerrada se acorta para que no se vea poligonal. Sale mas suave
    // Y mas barato que un paso fijo.
    const s0 = Math.floor((s - 12)/SEGb)*SEGb;
    const rbCur = RB.find(r => s > r.s0 - 200 && s < r.s1 + 60);
    let islandDone = false, halos = 0;

    const pasos = [];
    for (let d = -12; d <= FAR; ){
      const k = Math.abs(curv(s0 + d));
      const paso = k > 0.030 ? 2.5 : k > 0.008 ? SEGb*0.75 : SEGb*(d > 120 ? 2 : 1.4);
      pasos.push([d, paso]); d += paso;
    }
    for (let i = pasos.length - 1; i >= 0; i--){
      const d = pasos[i][0], SEG = pasos[i][1];
      const a = s0 + d, b = a + SEG;
      if (a < -20 || b > routeLen) continue;
      const A = xsec(a), B = xsec(b);
      const fog = clamp((d - fogEnd*0.25)/(fogEnd*0.9), 0, 1);
      const asf = mixc(pal.asphalt, fogRGB, fog);

      poly([ptOff(a,A.med), ptOff(b,B.med), ptOff(b,B.half), ptOff(a,A.half)], asf);
      poly([ptOff(a,-A.half), ptOff(b,-B.half), ptOff(b,-B.med), ptOff(a,-A.med)], asf);
      if (A.med > 0.05 && B.med > 0.05)          // sin mediana no hay quad que pintar
        poly([ptOff(a,-A.med), ptOff(b,-B.med), ptOff(b,B.med), ptOff(a,A.med)],
             mixc(groundRGB, fogRGB, fog));

      if (fog <= .82){                            // mas alla no se distinguen
        const lin = mixc(pal.line, fogRGB, fog);
        const band = (o1, o2, col, al) => {
          if (al !== undefined){ ctx.save(); ctx.globalAlpha = al; }
          poly([ptOff(a,o1,0.012), ptOff(b,o1,0.012), ptOff(b,o2,0.012), ptOff(a,o2,0.012)], col);
          if (al !== undefined) ctx.restore();
        };
        const dash = ((a % 12) + 12) % 12 < 4;
        if (A.f < 0.98 && dash) band(-0.09, 0.09, lin, 1 - A.f);
        if (A.f > 0.02){
          const dv = A.med + LANE;
          if (dash){ band(dv-0.09, dv+0.09, lin, A.f); band(-dv-0.09, -dv+0.09, lin, A.f); }
          for (const sg of [-1,1]){
            const o = sg*(A.med - 0.25);
            ctx.save(); ctx.globalAlpha = A.f;
            poly([ptOff(a,o,0.45), ptOff(b,o,0.45), ptOff(b,o,0.85), ptOff(a,o,0.85)],
                 mixc([158,164,168], fogRGB, fog));
            ctx.restore();
          }
        }
        for (const e of [A.half-0.3, -(A.half-0.3), A.med+0.3, -(A.med+0.3)]){
          if (Math.abs(e) < 0.4) continue;
          band(e-0.09, e+0.09, lin);
        }
      }

      if (!islandDone && rbCur && ((rbCur.s0+rbCur.s1)/2) - s > d - SEG){
        drawIsland(rbCur, pal, fogRGB); islandDone = true;
      }

      if (cfgOpt.posts && !lig && A.rf < 0.5 && Math.abs(curv(a)) <= 0.02 && fog <= .97){
        for (const sg of [-1,1]){
          const o = sg*(A.half + 1.7);
          poly([ptOff(a,o,0.5), ptOff(b,o,0.5), ptOff(b,o,0.85), ptOff(a,o,0.85)],
               mixc([150,156,160], fogRGB, fog));
          if (((a % 24)+24) % 24 < SEG){
            poly([ptOff(a,o-0.08,0), ptOff(a+0.4,o-0.08,0),
                  ptOff(a+0.4,o+0.08,5.6), ptOff(a,o+0.08,5.6)], mixc([92,98,104], fogRGB, fog));
            if (pal.glow > 0 && sg === 1 && halos < 3 && d < 90){
              // Un createRadialGradient cuesta mucho mas que un relleno plano.
              // Solo las tres farolas mas cercanas llevan halo; el resto, poste.
              const lp = projCopy(ptOff(a+0.2, o-1.5, 5.6));
              if (lp.ok){
                halos++;
                const r = Math.max(6, 900/lp.d);
                const g = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, r);
                g.addColorStop(0, `rgba(255,171,61,${.55*pal.glow*(1-fog)})`);
                g.addColorStop(1, 'rgba(255,171,61,0)');
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lp.x, lp.y, r, 0, 6.29); ctx.fill();
              }
            }
          }
        }
      }
    }
  }

  function shade(base, p0, p1, p2, fog, fogRGB, boost){
    const ux=p1.x-p0.x, uy=p1.y-p0.y, uz=p1.z-p0.z;
    const vx=p2.x-p0.x, vy=p2.y-p0.y, vz=p2.z-p0.z;
    let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const L = Math.hypot(nx,ny,nz) || 1; nx/=L; ny/=L; nz/=L;
    if ((cam.x-p0.x)*nx + (cam.y-p0.y)*ny + (cam.z-p0.z)*nz < 0) return null;   // culling
    // Rango de sombreado mas estrecho: con 0.38-1.00 dos caras vecinas podian
    // diferenciarse tanto que parecian piezas distintas. 0.55-1.00 las une.
    let k = (0.55 + 0.45*Math.abs(nx*LIGHT[0]+ny*LIGHT[1]+nz*LIGHT[2])) * (boost||1);
    // oclusión ambiente: los bajos reciben menos luz del cielo
    const alt = (p0.y + p1.y + p2.y)/3;
    if (alt < 0.75) k *= 0.62 + 0.38*(alt/0.75);
    // reflejo del cielo en horizontales + brillo rasante en los flancos
    const sp = Math.pow(Math.max(ny,0), 10)*62 + Math.pow(Math.max(1-Math.abs(ny),0), 6)*10;
    return mixc([Math.min(base[0]*k+sp,255), Math.min(base[1]*k+sp,255), Math.min(base[2]*k+sp,255)], fogRGB, fog);
  }

  function drawCar(pal, tail, head, sPos, offIn, colorIn, opp){
    sPos = sPos === undefined ? s : sPos;
    const fogRGB = hexToRgb(pal.skyBot);
    const rel = sPos - s;
    const fog = clamp((rel - cfgOpt.fogEnd*0.25)/(cfgOpt.fogEnd*0.9), 0, 1);
    if (fog > 0.96) return;
    const base = hexToRgb(colorIn || cfgOpt.carColor), glass = [22,26,31];
    const off = offIn === undefined ? myOffset(s) : offIn;
    // un coche de frente es el mismo modelo girado 180 grados: se invierten
    // a la vez el eje longitudinal y el transversal
    const fl = opp ? -1 : 1;
    const sc = cfgOpt.carScale || 1;
    const P = (z,x,y) => ptOff(sPos + z*fl*sc, off + x*fl*sc, y*sc);

    // Foto del propio coche: billboard anclado al eje trasero. La camara va
    // siempre detras, asi que un sprite plano funciona; en giro cerrado se nota.
    if (carImg && sPos === s && !opp){
      const pl = projCopy(ptOff(s-1.2, off-0.95, 0)), pr = projCopy(ptOff(s-1.2, off+0.95, 0));
      const pa = projCopy(ptOff(s-1.2, off, 0));
      if (pa.ok){
        let wpx = Math.abs(pr.x-pl.x) * 1.06 * (cfgOpt.carScale || 1);
        if (!isFinite(wpx) || wpx < 8) wpx = W*0.26*(cfgOpt.carScale || 1);
        // si el sprite no cabe en pantalla, se limita: mejor pequeño que fuera de cuadro
        wpx = Math.min(wpx, W*0.85);
        const hpx = wpx*carAR;
        ctx.save(); ctx.globalAlpha = 0.45;
        const sg2 = ctx.createRadialGradient(pa.x,pa.y,0,pa.x,pa.y,wpx*0.55);
        sg2.addColorStop(0,'rgba(0,0,0,.75)'); sg2.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle = sg2; ctx.beginPath();
        ctx.ellipse(pa.x, pa.y, wpx*0.55, wpx*0.15, 0, 0, 6.29); ctx.fill(); ctx.restore();
        ctx.drawImage(carImg, pa.x-wpx/2, pa.y-hpx*0.94, wpx, hpx);
        if (tail > 0.02){
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          for (const fx of [-0.31, 0.31]){
            const cx = pa.x+wpx*fx, cy = pa.y-hpx*0.44, r = wpx*(0.13+0.11*tail);
            const g = ctx.createRadialGradient(cx,cy,0,cx,cy,r);
            g.addColorStop(0,`rgba(255,64,42,${0.92*tail})`);
            g.addColorStop(0.45,`rgba(228,26,16,${0.45*tail})`);
            g.addColorStop(1,'rgba(228,26,16,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx,cy,r,0,6.29); ctx.fill();
          }
          ctx.restore();
        }
        return;
      }
    }
    // Las caras se acumulan y se pintan de lejos a cerca. Sin esto, una cara del
    // lado opuesto dibujada mas tarde tapaba a la cercana: de ahi las manchas
    // sueltas sobre el techo y los laterales.
    const cs = [];
    const prof = q => { let z = 0;
      for (const p of q) z += (p.x-cam.x)*fwd.x + (p.y-cam.y)*fwd.y + (p.z-cam.z)*fwd.z;
      return z/q.length; };
    const face = (q, col, boost) => { const c = shade(col, q[0], q[1], q[2], fog, fogRGB, boost);
      if (c) cs.push([prof(q), q, c]); };
    const plano = (q, col) => cs.push([prof(q), q, col]);
    const volcar = () => { cs.sort((a,b) => b[0] - a[0]);
      for (const c of cs) poly(c[1], c[2], true); cs.length = 0; };
    const glow = (p3, col, rad, al) => {
      const lp = projCopy(p3); if (!lp.ok) return;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const r = Math.max(5, rad/lp.d);
      const g = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, r);
      g.addColorStop(0, `rgba(${col},${al})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lp.x, lp.y, r, 0, 6.29); ctx.fill(); ctx.restore();
    };

    poly([P(-2.4,-1.05,0.008), P(2.4,-1.05,0.008), P(2.4,1.05,0.008), P(-2.4,1.05,0.008)],
         `rgba(0,0,0,${0.34*(1-fog)})`);

    for (const wz of [-1.4375, 1.4375]) for (const wx of [-0.915, 0.915]){
      const r = 0.340, a1 = [], a2 = [];
      for (let k = 0; k < 10; k++){ const a = k/10*6.2832;
        a1.push(P(wz+Math.cos(a)*r, wx, 0.350+Math.sin(a)*r));
        a2.push(P(wz+Math.cos(a)*r*0.56, wx*0.985, 0.350+Math.sin(a)*r*0.56)); }
      plano(a1, mixc([30,32,36], fogRGB, fog));
      plano(a2, mixc([96,102,110], fogRGB, fog));
    }
    for (let i = 0; i < PROF.length-1; i++){
      // Umbral bajo: con 0.15 las estaciones de la luneta trasera (0.150 y 0.305)
      // no contaban como cabina y se pintaban del color de la carroceria. Por eso
      // el techo parecia una pieza oscura flotando sobre un bloque blanco.
      const A = PROF[i], B = PROF[i+1], cabin = A[3] > 0.05 || B[3] > 0.05;
      for (const sg of [-1,1]){
        face([P(A[0],sg*A[1],0.34), P(B[0],sg*B[1],0.34), P(B[0],sg*B[1],B[2]), P(A[0],sg*A[1],A[2])], base);
        face([P(A[0],sg*A[1],A[2]), P(B[0],sg*B[1],B[2]), P(B[0],sg*B[3],B[4]), P(A[0],sg*A[3],A[4])],
             cabin ? glass : base, cabin ? 1.5 : 1);
      }
      if (A[3] > 0.02 || B[3] > 0.02)
        face([P(A[0],-A[3],A[4]), P(B[0],-B[3],B[4]), P(B[0],B[3],B[4]), P(A[0],A[3],A[4])],
             cabin ? glass : base, cabin ? 1.7 : 1);
      else
        face([P(A[0],-A[1]*.98,A[2]), P(B[0],-B[1]*.98,B[2]), P(B[0],B[1]*.98,B[2]), P(A[0],A[1]*.98,A[2])], base);
    }
    const detalle = cfgOpt.detalleCoche && !ligero();
    // TAPAS DE LOS EXTREMOS. El loft solo cosia laterales, hombro y techo: los
    // dos extremos quedaban ABIERTOS y desde la camara, que mira al porton, se
    // veia el interior hueco. Esto era lo que hacia que pareciera un despiece.
    for (const [idx, sgn] of [[0, -1], [PROF.length-1, 1]]){
      const S = PROF[idx];
      const tapa = [P(S[0], -S[1], 0.34), P(S[0], S[1], 0.34), P(S[0], S[1], S[2])];
      if (S[3] > 0.02){ tapa.push(P(S[0], S[3], S[4]), P(S[0], -S[3], S[4])); }
      else tapa.push(P(S[0], 0, S[4]));
      tapa.push(P(S[0], -S[1], S[2]));
      // El sentido de giro decide hacia donde mira la normal: en la tapa trasera
      // hay que invertirlo o el culling se la come.
      face(sgn < 0 ? tapa.slice().reverse() : tapa, base);
    }

    // zócalo oscuro bajo la cintura: rompe la masa y hace el coche menos "bloque"
    if (detalle) for (const sg of [-1,1])
      for (let i = 2; i < PROF.length-3; i++){
        const A = PROF[i], B = PROF[i+1];
        plano([P(A[0], sg*(A[1]-0.002), 0.335), P(B[0], sg*(B[1]-0.002), 0.335),
              P(B[0], sg*(B[1]-0.002), 0.50),  P(A[0], sg*(A[1]-0.002), 0.50)],
             mixc([base[0]*0.42, base[1]*0.42, base[2]*0.44], fogRGB, fog));
      }
    // pasos de rueda
    if (detalle) for (const wz of [-1.42, 1.46]) for (const sg of [-1,1]){
      const arc = [];
      for (let a = 0; a <= 8; a++){ const an = Math.PI*a/8;
        arc.push(P(wz - Math.cos(an)*0.62, sg*0.930, 0.350 + Math.sin(an)*0.58)); }
      for (let a = 8; a >= 0; a--){ const an = Math.PI*a/8;
        arc.push(P(wz - Math.cos(an)*0.52, sg*0.930, 0.350 + Math.sin(an)*0.48)); }
      plano(arc, mixc([26,28,32], fogRGB, fog));
    }
    // retrovisores
    if (detalle) for (const sg of [-1,1])
      plano([P(0.92, sg*0.92, 1.05), P(1.06, sg*1.17, 1.09),
            P(0.98, sg*1.17, 1.19), P(0.84, sg*0.92, 1.15)],
           mixc([base[0]*0.72, base[1]*0.72, base[2]*0.75], fogRGB, fog));
    // montante trasero: separa luna de carrocería y da lectura de volumen
    if (detalle) for (const sg of [-1,1])
      plano([P(-1.60, sg*0.305, 1.212), P(-1.90, sg*0.150, 1.125),
            P(-1.90, sg*0.100, 1.100), P(-1.60, sg*0.255, 1.190)],
           mixc([base[0]*0.55, base[1]*0.55, base[2]*0.58], fogRGB, fog));

    volcar();   // aqui se pinta toda la carroceria, ya ordenada

    // PARACHOQUES TRASERO. Los pilotos arrancan a 0.905 y el faldon acaba a
    // 0.34: el punto medio cae en 0.62, asi que de ahi hacia abajo va en negro.
    // Envuelve un poco por los flancos, como en un paragolpes real.
    {
      const yTope = 0.62, yPie = 0.335;
      const negro = mixc([26, 28, 32], fogRGB, fog);
      poly([P(-2.336, -0.800, yPie), P(-2.336, 0.800, yPie),
            P(-2.336, 0.800, yTope), P(-2.336, -0.800, yTope)], negro, true);
      for (const sg of [-1, 1])
        poly([P(-2.336, sg*0.800, yPie), P(-2.10, sg*0.868, yPie),
              P(-2.10, sg*0.868, yTope), P(-2.336, sg*0.800, yTope)], negro, true);
      // difusor: franja mas oscura al ras del suelo
      poly([P(-2.334, -0.62, yPie), P(-2.334, 0.62, yPie),
            P(-2.334, 0.62, yPie+0.075), P(-2.334, -0.62, yPie+0.075)],
           mixc([16, 17, 20], fogRGB, fog), true);
    }

    // ópticas: son geometría permanente, apagadas son cristal oscuro
    for (const sg of [-1,1]){
      poly([P(-2.335,sg*0.26,0.905), P(-2.335,sg*0.80,0.905), P(-2.335,sg*0.80,1.010), P(-2.335,sg*0.26,1.010)],
           mixc([74+181*tail, 14+42*tail, 18], fogRGB, fog));
      if (tail > 0.2) glow(P(-2.34, sg*0.53, 0.955), '255,54,32', 300, 0.60*tail);
      const b = head > 0.2 ? [252,250,236] : [58,62,70];
      poly([P(2.335,sg*0.26,0.760), P(2.335,sg*0.74,0.760), P(2.335,sg*0.74,0.880), P(2.335,sg*0.26,0.880)],
           mixc(b, fogRGB, fog));
      if (head > 0.2) glow(P(2.35, sg*0.50, 0.820), '255,246,220', 420, 0.55*head);
    }
    if (tail > 0.2){
      poly([P(-2.330,-0.27,0.560), P(-2.330,0.27,0.560), P(-2.330,0.27,0.690), P(-2.330,-0.27,0.690)],
           mixc([200+55*tail, 202+53*tail, 196+52*tail], fogRGB, fog));
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      poly([P(-2.326,-0.27,0.560), P(-2.326,0.27,0.560), P(-2.326,0.27,0.700), P(-2.326,-0.27,0.700)],
           `rgba(255,240,205,${0.30*tail})`);
      ctx.restore();
      for (const sg of [-1,1]) glow(P(-2.318, sg*0.19, 0.720), '255,240,203', 260, 0.85*tail);
    }
  }

  function drawBeams(pal, on){
    if (on <= 0) return;
    const off = myOffset(s), reach = cfgOpt.beamReach;
    // El eje del gradiente va de SUELO a SUELO. Anclarlo en la óptica desplaza la
    // banda brillante hacia arriba y parece un foco apuntando al cielo.
    const g0 = projCopy(ptOff(s+2.6, off, 0.02));
    const g1 = projCopy(ptOff(s+reach*1.1, off, 0.02));
    if (!g0.ok || !g1.ok) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const cone = (from, sn, sf, len) => {
      const q = [ptOff(s+2.45, from-sn, 0.02), ptOff(s+len, from-sf, 0.02),
                 ptOff(s+len, from+sf, 0.02), ptOff(s+2.45, from+sn, 0.02)];
      const sc = [];
      for (const p of q){ const r = project(p); if (!r.ok) return null; sc.push({x:r.x, y:r.y}); }
      return sc;
    };
    const paint = (sc, stops) => {
      ctx.beginPath(); ctx.moveTo(sc[0].x, sc[0].y);
      for (let k = 1; k < 4; k++) ctx.lineTo(sc[k].x, sc[k].y);
      ctx.closePath(); ctx.save(); ctx.clip();
      const g = ctx.createLinearGradient(g0.x, g0.y, g1.x, g1.y);
      for (const st of stops) g.addColorStop(st[0], st[1]);
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H); ctx.restore();
    };
    for (const lamp of [off-0.62, off+0.62]){
      const sc = cone(lamp, 0.40, 2.2 + reach*0.045, reach);
      if (sc) paint(sc, [
        [0,   `rgba(255,247,224,${0.27*on})`], [0.16, `rgba(255,244,212,${0.165*on})`],
        [0.40,`rgba(248,240,212,${0.070*on})`], [0.66, `rgba(236,236,216,${0.022*on})`],
        [0.88,'rgba(230,232,214,0)'], [1,'rgba(230,232,214,0)']
      ]);
    }
    const hot = cone(off, 0.80, 1.9, Math.min(11, reach*0.45));
    if (hot) paint(hot, [
      [0,`rgba(255,251,236,${0.32*on})`], [0.20,`rgba(255,247,220,${0.13*on})`],
      [0.40,'rgba(255,247,220,0)'], [1,'rgba(255,247,220,0)']
    ]);
    ctx.restore();
  }

  /* ---------------- efectos opcionales ---------------- */

  const rainDrops = Array.from({length:260}, () => ({x:Math.random(), y:Math.random(), l:Math.random()}));
  function drawRain(dt){
    ctx.strokeStyle = 'rgba(190,215,235,.5)'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (const r of rainDrops){
      r.y += (0.55 + r.l*0.8) * dt * (1 + speed/26);
      if (r.y > 1){ r.y = -0.05; r.x = Math.random(); }
      const px = r.x*W, py = r.y*H, len = 10 + r.l*26 + speed*0.9;
      ctx.moveTo(px, py); ctx.lineTo(px - (px - W/2)*0.035, py - len);
    }
    ctx.stroke();
  }

  // Agua de las ruedas. Cada gota guarda su estado: no "sale hacia atras",
  // se queda quieta y es el coche el que se va.
  const spray = [], WHEELS = [[-1.42,-0.93],[-1.42,0.93],[1.46,-0.93],[1.46,0.93]];
  const BODY_REAR = -2.34;
  let sprayAcc = 0;
  function updateSpray(dt){
    if (!(cfgOpt.rain && cfgOpt.spray) || speed < 4){ spray.length = 0; return; }
    sprayAcc += Math.min(speed*9, 170) * dt;
    while (sprayAcc > 1 && spray.length < 320){
      sprayAcc--;
      const w = WHEELS[(Math.random()*4)|0];
      const p = { ds: w[0]-0.30, off: w[1] + Math.sign(w[1])*(0.06+Math.random()*0.10), y: 0.02,
        vs: speed*(0.30+Math.random()*0.35), vo: Math.sign(w[1])*(0.25+Math.random()*0.85)+(Math.random()-0.5)*0.4,
        vy: 0.55+Math.random()*1.5, r: 0.035+Math.random()*0.05,
        life: (w[0] < 0 ? 0.42 : 0.30) + Math.random()*0.30 };
      p.max = p.life; spray.push(p);
    }
    for (let i = spray.length-1; i >= 0; i--){
      const p = spray[i];
      p.ds -= p.vs*dt; p.off += p.vo*dt; p.vo *= (1-2.2*dt);
      p.y += p.vy*dt; p.vy -= 5.4*dt; if (p.y < 0.01){ p.y = 0.01; p.vy = 0; }
      p.vs *= (1-1.1*dt); p.r += 0.55*dt; p.life -= dt;
      if (p.life <= 0) spray.splice(i,1);
    }
  }
  // Dos pasadas: la camara va detras, asi que las gotas por delante del
  // paragolpes trasero las tapa la chapa y las de atras van por encima.
  function drawSpray(pal, phase){
    if (!spray.length) return;
    const off = myOffset(s);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of spray){
      if (p.ds > BODY_REAR && p.ds < 2.34 && Math.abs(p.off) < 1.00 && p.y < 1.05) continue;
      const behind = p.ds <= BODY_REAR;
      if (phase === 'far' ? behind : !behind) continue;
      const a = p.life/p.max, al = a*a*0.19*(pal.glow > 0 ? 1.5 : 1), r = p.r;
      poly([ptOff(s+p.ds-r, off+p.off-r, p.y), ptOff(s+p.ds-r, off+p.off+r, p.y),
            ptOff(s+p.ds+r, off+p.off+r, p.y+r*1.6), ptOff(s+p.ds+r, off+p.off-r, p.y+r*1.6)],
           `rgba(228,238,246,${al})`);
    }
    ctx.restore();
  }

  // Trafico esporadico en los dos sentidos. El de mi carril nunca se deja
  // atropellar: a 18 m copia mi velocidad.
  const CAR_COLORS = ['#8d99a4','#b06d4a','#4a545e','#c9ced4','#5a6b52','#7a4550','#2f3540'];
  const DENSITY = { poca:[16,34], normal:[7,16], mucha:[2.5,6] };
  let cars = [], spawnTimer = 5;
  function updateTraffic(dt){
    const dens = DENSITY[cfgOpt.traffic];
    if (!dens){ cars.length = 0; return; }
    if ((spawnTimer -= dt) <= 0){
      const col = CAR_COLORS[(Math.random()*CAR_COLORS.length)|0];
      const mwHere = xsec(Math.min(s+300, routeLen-1)).f;
      if (Math.random() < 0.55)
        cars.push({ pos: s + 420 + Math.random()*420, v: 14 + Math.random()*13, dir:-1, lane:'opp', color:col });
      else {
        const adj = mwHere > 0.5 && Math.random() < 0.6;
        cars.push({ pos: s + 220 + Math.random()*300,
                    v: Math.max(9, speed*(adj?0.70:0.84) + (Math.random()-0.5)*4),
                    dir:1, lane: adj?'adj':'same', color:col });
      }
      spawnTimer = dens[0] + Math.random()*(dens[1]-dens[0]);
    }
    for (let i = cars.length-1; i >= 0; i--){
      const c = cars[i];
      c.pos += c.dir*c.v*dt;
      const rel = c.pos - s;
      if (c.lane === 'same'){
        if (rel < 18){ c.pos = s + 18; c.v = speed; }
        else if (rel > 26 && c.v > speed) c.v = Math.max(9, speed*0.84);
      }
      if (rel < -90 || rel > 1100 || c.pos > routeLen-2 || c.pos < 2) cars.splice(i,1);
    }
  }
  function drawTraffic(pal){
    if (!cars.length) return;
    const on = pal.glow;
    for (const c of [...cars].sort((a,b) => (b.pos-s) - (a.pos-s))){
      const cc = xsec(c.pos);
      const off = c.lane === 'opp' ? -cc.mine : c.lane === 'adj' ? cc.mine - LANE*cc.f : cc.mine;
      drawCar(pal, c.dir < 0 ? 0 : 0.30*on, c.dir < 0 ? on : 0, c.pos, off, c.color, c.dir < 0);
    }
  }

  /* ---------------- Carteles de dirección ----------------
     Se plantan 170 m antes de cada maniobra que tenga nombre de calle.
     Azul en autovía, blanco en convencional, como en carretera de verdad.
     En autovía van sobre pórtico; en convencional, en poste al margen. */
  function drawSigns(pal){
    if (!cfgOpt.carteles || !manList.length) return;
    const fogRGB = hexToRgb(pal.skyBot);
    for (const m of manList){
      const calle = m.calle;
      if (!calle) continue;
      const sMet = m.metro - 170;                       // dónde se planta el cartel
      const d = sMet - s;
      if (d < -8 || d > Math.min(cfgOpt.fogEnd, 260)) continue;
      const cx = xsec(sMet);
      const mw = cx.f > 0.5;
      const fog = clamp((d - cfgOpt.fogEnd*0.3)/(cfgOpt.fogEnd*0.8), 0, 1);
      if (fog > 0.9) continue;

      const anchoM = mw ? 5.6 : 3.4, altoM = mw ? 1.9 : 1.25;
      const yBase = mw ? 5.4 : 2.5;                     // pórtico alto o poste bajo
      const lado = mw ? 0 : cx.half + 1.9;              // centrado o al margen derecho
      const P = (o, y) => ptOff(sMet, lado + o, y);

      // postes
      const poste = c => mixc([88,94,100], fogRGB, fog);
      if (mw){
        for (const sg of [-1, 1])
          poly([P(sg*(anchoM/2+0.2)-0.09, 0), P(sg*(anchoM/2+0.2)+0.09, 0),
                P(sg*(anchoM/2+0.2)+0.09, yBase+altoM), P(sg*(anchoM/2+0.2)-0.09, yBase+altoM)], poste());
      } else {
        poly([P(-0.09, 0), P(0.09, 0), P(0.09, yBase+altoM), P(-0.09, yBase+altoM)], poste());
      }

      // panel
      const quad = [P(-anchoM/2, yBase), P(anchoM/2, yBase),
                    P(anchoM/2, yBase+altoM), P(-anchoM/2, yBase+altoM)];
      const base = mw ? [22, 62, 138] : [236, 238, 234];
      if (!poly(quad, mixc(base, fogRGB, fog))) continue;
      // marco
      const borde = mw ? [232,236,244] : [40,44,48];
      poly([P(-anchoM/2, yBase), P(anchoM/2, yBase), P(anchoM/2, yBase+0.09), P(-anchoM/2, yBase+0.09)], mixc(borde, fogRGB, fog));
      poly([P(-anchoM/2, yBase+altoM-0.09), P(anchoM/2, yBase+altoM-0.09),
            P(anchoM/2, yBase+altoM), P(-anchoM/2, yBase+altoM)], mixc(borde, fogRGB, fog));

      // texto: se proyectan dos esquinas para saber cuánto mide en pantalla
      const a = projCopy(P(-anchoM/2, yBase + altoM*0.5));
      const b = projCopy(P( anchoM/2, yBase + altoM*0.5));
      const c = projCopy(P(-anchoM/2, yBase));
      if (!a.ok || !b.ok || !c.ok) continue;
      const wpx = Math.hypot(b.x-a.x, b.y-a.y);
      if (wpx < 34) continue;                           // demasiado lejos para leerlo
      const hpx = Math.hypot(c.x-a.x, c.y-a.y)*2;
      let txt = String(calle).toUpperCase();
      if (m.tipo === 'roundabout' && m.salida) txt = m.salida + 'ª  ' + txt;
      ctx.save();
      ctx.translate((a.x+b.x)/2, (a.y+b.y)/2);
      ctx.rotate(Math.atan2(b.y-a.y, b.x-a.x));
      let fs = Math.min(hpx*0.42, wpx/Math.max(txt.length, 1)*1.55);
      ctx.font = `700 ${Math.max(6, fs)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 1 - fog;
      ctx.fillStyle = mw ? '#f2f6ff' : '#14181c';
      ctx.fillText(txt, 0, 0, wpx*0.9);
      ctx.restore();
    }
  }

  /* ---------------- HUD: maniobra, velocidad, límite, radar ---------------- */

  // Si tu app no llama a setManeuver(), la maniobra se deduce de la geometría:
  // se busca el primer cambio de rumbo acumulado significativo por delante.
  function maniobraGeom(){
    for (const r of RB){
      const d = r.s0 - s;
      if (d > -6 && d < 420) return { tipo:'roundabout', dist: Math.max(0, d) };
    }
    const h0 = at(s).h;
    for (let d = 50; d < 400; d += 20){
      let dh = at(s+d).h - h0;
      while (dh >  Math.PI) dh -= 2*Math.PI;
      while (dh < -Math.PI) dh += 2*Math.PI;
      if (Math.abs(dh) > 0.42) return { tipo: dh > 0 ? 'right' : 'left', dist: d };
    }
    return { tipo:'straight', dist: 0 };
  }

  const ARROWS = {
    straight:  'M20 4 L32 20 L24 20 L24 36 L16 36 L16 20 L8 20 Z',
    right:     'M24 6 L36 18 L24 30 L24 22 L14 22 L14 34 L6 34 L6 14 L24 14 Z',
    left:      'M16 6 L4 18 L16 30 L16 22 L26 22 L26 34 L34 34 L34 14 L16 14 Z',
    roundabout:'M18 36 L18 24 A9 9 0 1 1 27 15 L34 15 L27 6 L20 15 L26 15 A5 5 0 1 0 22 22 L22 36 Z'
  };
  const arrowCache = {};
  function arrowPath(tipo){
    if (!arrowCache[tipo]) arrowCache[tipo] = new Path2D(ARROWS[tipo] || ARROWS.straight);
    return arrowCache[tipo];
  }

  const fmtDist = d => d < 30 ? 'Ahora'
    : d < 100 ? Math.round(d/10)*10 + ' m'
    : d < 1000 ? Math.round(d/50)*50 + ' m'
    : (d/1000).toFixed(1) + ' km';

  function drawHUD(){
    const k = (Math.min(W, H) / 420) * (cfgOpt.hudScale || 1);
    const pad = Math.round(14*k);
    // la maniobra de la lista manda mientras no la hayas pasado
    let m = manOver;
    if (!m && manList.length){
      const sig = manList.find(x => x.metro > s - 12);
      if (sig) m = { tipo: sig.tipo, dist: Math.max(0, sig.metro - s),
                     calle: sig.calle, salida: sig.salida };
    }
    if (!m) m = maniobraGeom();

    // panel de maniobra
    if (m && m.tipo !== 'straight'){
      const bw = Math.round(200*k), bh = Math.round(64*k);
      ctx.save();
      ctx.fillStyle = 'rgba(10,13,16,.72)';
      ctx.fillRect(pad, pad, bw, bh);
      ctx.fillStyle = '#5fd0e0';
      ctx.fillRect(pad, pad, Math.max(2, 3*k), bh);
      ctx.translate(pad + 14*k, pad + (bh - 38*k)/2);
      ctx.scale(k, k);
      ctx.fillStyle = '#5fd0e0';
      ctx.fill(arrowPath(m.tipo));
      ctx.restore();

      ctx.save();
      ctx.fillStyle = '#e8eef2';
      ctx.font = `600 ${Math.round(26*k)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(fmtDist(m.dist), pad + 62*k, pad + 30*k);
      let calle = m.calle || streetOver;
      if (m.tipo === 'roundabout' && m.salida) calle = m.salida + 'ª salida' + (calle ? ' · ' + calle : '');
      if (calle){
        ctx.fillStyle = '#7b8b96';
        ctx.font = `${Math.round(11*k)}px ui-sans-serif,system-ui,sans-serif`;
        ctx.fillText(String(calle).slice(0, 22).toUpperCase(), pad + 62*k, pad + 48*k);
      }
      ctx.restore();
    }

    // velocidad
    ctx.save();
    ctx.fillStyle = '#e8eef2';
    ctx.font = `200 ${Math.round(86*k)}px ui-sans-serif,system-ui,sans-serif`;
    ctx.textBaseline = 'alphabetic';
    const kmh = String(Math.round(speed*3.6));
    ctx.fillText(kmh, pad, H - pad - 6*k);
    const wkm = ctx.measureText(kmh).width;
    ctx.fillStyle = '#7b8b96';
    ctx.font = `${Math.round(14*k)}px ui-sans-serif,system-ui,sans-serif`;
    ctx.fillText('KM/H', pad + wkm + 10*k, H - pad - 10*k);
    ctx.restore();

    // límite de velocidad
    let lim = limitOver;
    if (lim === null && limList.length){
      let v = null;
      for (const x of limList){ if (x.metro <= s + 5) v = x.kmh; else break; }
      lim = v;
    }
    if (lim === null) lim = xsec(s).f > 0.5 ? 120 : null;
    if (lim){
      const r = 30*k, cx = W - pad - r, cy = H - pad - r;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832);
      ctx.fillStyle = '#f3f3f0'; ctx.fill();
      ctx.lineWidth = 6*k; ctx.strokeStyle = '#d8352a'; ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.font = `700 ${Math.round(24*k)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(lim), cx, cy + 1);
      ctx.restore();
    }

    // aviso de radar
    let rad = radarOver;
    if (rad === null && radList.length){
      const sig = radList.find(x => x.metro > s - 20);
      if (sig) rad = sig.metro - s;
    }
    if (rad !== null && rad < 600){
      ctx.save();
      const bw = Math.round(150*k), bh = Math.round(32*k), bx = W - pad - bw;
      ctx.fillStyle = 'rgba(255,90,77,.18)'; ctx.fillRect(bx, pad, bw, bh);
      ctx.strokeStyle = '#ff5a4d'; ctx.lineWidth = 1; ctx.strokeRect(bx+.5, pad+.5, bw-1, bh-1);
      ctx.fillStyle = '#ff5a4d';
      ctx.font = `${Math.round(12*k)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('RADAR · ' + fmtDist(rad), bx + 12*k, pad + bh/2);
      ctx.restore();
    }
  }

  /* ---------------- bucle ---------------- */

  function resize(){
    // El coste de rasterizado va con el numero de pixeles, o sea con el CUADRADO
    // de la escala: a 0.6 se pinta el 36% de los pixeles. El canvas se sigue
    // estirando por CSS al tamano completo, asi que no cambia la maquetacion.
    dpr = Math.min(window.devicePixelRatio || 1, 2) * clamp(cfgOpt.escala || 1, 0.35, 1);
    const r = canvas.getBoundingClientRect();
    const nw = Math.max(200, r.width | 0), nh = Math.max(150, r.height | 0);
    if (nw === W && nh === H && Math.abs(canvas.width - W*dpr) < 1) return;
    W = nw; H = nh;
    canvas.width = Math.round(W*dpr); canvas.height = Math.round(H*dpr);
    canvas.style.width = '100%'; canvas.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    xsCache.clear();
  }

  // Arrastrar el divisor del Split cambia el tamaño del panel SIN disparar el
  // evento resize de la ventana: sin esto, el HUD sigue con las medidas viejas
  // hasta que se cambia de modo.
  let ro = null;
  if (typeof ResizeObserver !== 'undefined'){
    let pend = 0;
    ro = new ResizeObserver(() => {
      if (pend) return;
      pend = requestAnimationFrame(() => { pend = 0; resize(); });
    });
    try { ro.observe(canvas); } catch(e){}
  }

  // Perfil automático: si el equipo no sostiene 26 fps, se recorta solo.
  let fpsMedia = 60, autoLigero = false;
  const ligero = () => cfgOpt.perfil === 'ligero'
    || (cfgOpt.perfil === 'auto' && autoLigero);
  api.fps = () => Math.round(fpsMedia);

  function frame(now){
    const dt = Math.min((now - last)/1000, 0.05); last = now;
    if (dt > 0){
      fpsMedia += (1/dt - fpsMedia) * 0.05;
      if (!autoLigero && fpsMedia < 26) autoLigero = true;
      else if (autoLigero && fpsMedia > 48) autoLigero = false;
    }
    if (cfgOpt.maxFps && now - lastDraw < 1000/cfgOpt.maxFps - 1) return;
    lastDraw = now;
    if (!pts) return;
    // red de seguridad para navegadores sin ResizeObserver
    if ((frameN++ & 31) === 0) resize();

    prevSpeed = speed;
    speed += (targetSpeed - speed) * Math.min(dt*2.2, 1);
    const accel = dt > 0 ? (speed - prevSpeed)/dt : 0;
    const want = clamp((-accel - 0.35)/1.8, 0, 1);
    brake += (want - brake) * Math.min(dt*(want > brake ? 14 : 5), 1);
    s = clamp(s + speed*dt, 0, routeLen - 1);

    const pal = palette();
    dtCam = dt || 0.016;
    setupCamera();
    drawSky(pal);
    drawRoad(pal);
    drawBeams(pal, pal.glow);
    drawSigns(pal);
    if (!ligero()){ updateTraffic(dt); drawTraffic(pal); } else cars.length = 0;
    if (!ligero()) updateSpray(dt); else spray.length = 0;
    drawSpray(pal, 'far');
    drawCar(pal, Math.max(0.30*pal.glow, brake), pal.glow);
    drawSpray(pal, 'near');
    if (cfgOpt.rain && !ligero()) drawRain(dt);
    if (cfgOpt.hud) drawHUD();
  }

  function loop(now){
    raf = requestAnimationFrame(loop);
    // Un fallo aquí no debe dejar de dibujar en silencio.
    try { frame(now); }
    catch (err){ cancelAnimationFrame(raf); running = false;
      if (api.onError) api.onError(err); else console.error('[hud2]', err); }
  }

  api.start = () => { if (running) return; running = true; resize(); last = performance.now(); raf = requestAnimationFrame(loop); };
  api.stop  = () => { running = false; cancelAnimationFrame(raf); };
  api.resize = resize;
  api.set = o => {
    const redo = ('rbRadius' in o) || ('rbArc' in o);
    const reesc = ('escala' in o) && o.escala !== cfgOpt.escala;
    Object.assign(cfgOpt, o);
    if (reesc){ W = 0; H = 0; resize(); }
    if (redo && pts){ RB = detectRoundabouts(); xsCache.clear(); }
  };
  api.state = () => ({ s, speed, routeLen, rotondas: RB.length, running });
  api.destroy = () => { api.stop(); if (ro) try { ro.disconnect(); } catch(e){}
                        pts = null; RB = []; MW = []; };

  window.addEventListener('resize', resize);
  resize();
  return api;
}
