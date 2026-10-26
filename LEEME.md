# Mis Gastos

PWA estática (HTML + JS, sin compilación) que se publica en Vercel y se empaqueta como APK con PWABuilder.
Los datos se guardan en Supabase. Sin internet, la app sigue funcionando: los gastos quedan en el teléfono y se suben cuando vuelve la conexión.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html`, `styles.css`, `app.js` | La app |
| `config.js` | URL y llave de Supabase (lo único que hay que editar) |
| `supabase.sql` | Crea la tabla `gastos` con seguridad por usuario |
| `manifest.json`, `icons/` | Lo que la hace instalable (PWA) |
| `sw.js` | Service worker: permite abrirla sin internet |
| `assetlinks.json` | Vincula el APK con el sitio (se llena en el paso 5) |
| `vercel.json` | Publica `assetlinks.json` en `/.well-known/` |

## 1. Supabase (base de datos y login)

1. Crear cuenta y proyecto en https://supabase.com (plan gratis).
2. **SQL Editor** → pegar el contenido de `supabase.sql` → **Run**.
3. **Project Settings → API Keys**: copiar la *anon key* (pestaña "Legacy API keys", empieza con `eyJ…`).
   **Project Settings → Data API**: copiar la *Project URL*.
4. Pegar ambos datos en `config.js`.

## 2. GitHub (donde vive el código)

1. Crear un repositorio nuevo en https://github.com (puede ser privado).
2. **Add file → Upload files** → arrastrar **el contenido** de esta carpeta (no la carpeta en sí) → **Commit**.

## 3. Vercel (publicación)

1. En https://vercel.com → **Add New → Project** → importar el repositorio.
2. Framework Preset: **Other**. Sin comando de build. **Deploy**.
3. Queda en una URL tipo `https://mis-gastos-xxxx.vercel.app`.
4. En Supabase → **Authentication → URL Configuration → Site URL**: pegar esa URL
   (es a donde lleva el correo de confirmación de cuenta).

Desde ahora, cada cambio que se suba a GitHub se publica solo en Vercel.

## 4. Primera prueba

1. Abrir la URL en Chrome del celular → **Crear cuenta** → confirmar el correo → **Entrar**.
2. Cuando las dos cuentas estén creadas (la tuya y la de tu pareja), en Supabase →
   **Authentication → Sign In / Providers** desactivar **Allow new users to sign up**,
   para que nadie más pueda registrarse.

## 5. APK con PWABuilder

1. Ir a https://www.pwabuilder.com → pegar la URL de Vercel → **Start**.
2. **Package for stores → Android → Generate Package** (los valores por defecto sirven).
3. Se descarga un `.zip` con:
   - el `.apk` para instalar en el teléfono,
   - un `assetlinks.json`,
   - `signing.keystore` y `signing-key-info.txt` → **guardarlos en un lugar seguro**:
     sin ellos no se puede generar una actualización del mismo APK.
4. Reemplazar el contenido de `assetlinks.json` de este proyecto con el del zip, subirlo a GitHub
   (Vercel lo publica solo). Esto quita la barra de dirección de Chrome dentro de la app.
5. Pasar el `.apk` al teléfono e instalarlo (Android pedirá permitir "instalar apps desconocidas").

## Cambios futuros

- Cambios en la app (pantallas, categorías, etc.): editar y subir a GitHub. El APK **no** se regenera.
- Si se cambia algo de `sw.js`, subir el número en `const CACHE = 'gastos-v1'`.
- Categorías y medios de pago: al inicio de `app.js` (`CATEGORIAS`, `METODOS`).
