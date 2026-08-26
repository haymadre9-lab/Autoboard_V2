# AutoBoard v2 (MapLibre)

Mapa VECTORIAL con MapLibre GL + MapTiler: gira e inclina en la GPU (como un navegador real), sin el problema de teselas.
La clave MapTiler va incrustada en index.html (const MAPTILER_KEY) — restríngela por dominio en tu panel MapTiler.

# AutoBoard

Tablero de coche estilo Android Auto, en el navegador (PWA). Basado en el motor de Tesla Nav.

## Novedad frente a Tesla Nav
Pantalla partida: **HUD a la izquierda** (coche + velocímetro) y **mapa/navegación a la derecha**, con:
- **Divisor arrastrable**: mueve la línea central para dar más espacio al HUD o al mapa.
- **Tres modos** (barra arriba a la izquierda): **HUD** solo, **Split** (partido), **Mapa** solo.
- Recuerda tu modo y el tamaño del divisor entre sesiones.

Todo lo demás sigue igual: buscador de destino y voz, rutas (TomTom + OSRM), tráfico, radares, cargadores, tiempo y lluvia.

## Publicar (GitHub Pages)
1. Sube TODOS estos archivos a la raíz de un repo público:
   index.html, config.html, manifest.webmanifest, sw.js, radares.json, icon-192.png, icon-512.png, icon-180.png
2. Settings → Pages → rama main, carpeta / (root) → Save.
3. Abre `https://TU-USUARIO.github.io/TU-REPO/` y acepta el permiso de ubicación.

El GPS necesita HTTPS (GitHub Pages ya lo es). En el móvil/Tesla: "Añadir a pantalla de inicio" para instalarlo como app.

## Uso
- Barra arriba-izquierda: **HUD / Split / Mapa**.
- Arrastra el **divisor** central para redimensionar.
- 🎯 recentrar, ⚙️ ajustes, 🔄 refrescar (en el panel del mapa).

## ⚠️ Seguridad (importante)
Este proyecto hereda de Tesla Nav las claves API en texto plano dentro del código
(TomTom en index.html, Supabase en config.html). Si subes el repo como público,
cualquiera puede verlas y gastar tu cuota. Conviene restringir la clave de TomTom
por dominio en su panel, o moverla a un proxy propio.

## App nativa (opcional)
Es la misma web envuelta en un WebView. Para generar un APK sin programar:
- **PWABuilder** (pwabuilder.com): pega la URL de tu GitHub Pages y descarga el APK.
- O **Bubblewrap** (TWA de Google) si quieres línea de comandos.
No hay una versión "nativa" distinta: es esta misma PWA dentro de una cáscara.
