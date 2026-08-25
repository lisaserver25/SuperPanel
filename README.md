# SuperPanel

Panel unificado de acceso a todos tus paneles: lanzador con embebido + auto-login para paneles propios (con puente SuperPanel) y bóveda de credenciales cifradas para paneles de terceros.

- **Frontend:** React 18 + Vite + TS + Tailwind (HashRouter), publicado en GitHub Pages.
- **Backend:** Supabase (Auth, tablas `super_*` aditivas, Vault para cifrado, edge function `panel-login`).
- **Modelo personal:** cada usuario administra sus propios paneles y credenciales (RLS owner-only).

## Desarrollo

```bash
npm install
cp .env.example .env   # rellenar VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

## Despliegue

- Base de datos: `npm run db:push`
- Edge function: `npm run functions:deploy`
- Frontend: push a `main` (GitHub Actions → Pages). Requiere secrets `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
