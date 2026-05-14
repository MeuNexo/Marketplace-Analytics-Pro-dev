# Tech Stack

## Framework & Runtime
- **React 18.3.1** — UI framework (not Next.js; pure SPA)
- **TypeScript 5.8.3** — all source files in `src/`
- **Vite 5.4.19** — build tool and dev server (port 8080, SWC-based transpiler)
- **@vitejs/plugin-react-swc 3.11.0** — SWC replaces Babel for fast compilation

## Edge Functions Runtime
- **Deno** (Supabase-hosted) — all edge functions use `https://deno.land/std@0.168.0/http/server.ts`
- Deno imports: `@supabase/supabase-js@2` via `https://esm.sh/`, `zod@v3.22.4` via `https://deno.land/x/zod`

## Routing
- **react-router-dom 6.30.1** — client-side routing (SPA)

## Server State & Data Fetching
- **@tanstack/react-query 5.83.0** — server state, caching, background refetch

## UI Component Library
- **shadcn/ui** pattern (components.json present) — Radix UI primitives + Tailwind CSS
- Full Radix UI suite: accordion, alert-dialog, aspect-ratio, avatar, checkbox, collapsible, context-menu, dialog, dropdown-menu, hover-card, label, menubar, navigation-menu, popover, progress, radio-group, scroll-area, select, separator, slider, slot, switch, tabs, toast, toggle, toggle-group, tooltip
- **lucide-react 1.7.0** — icon library
- **cmdk 1.1.1** — command palette
- **vaul 0.9.9** — drawer component
- **react-resizable-panels 2.1.9** — resizable panel layouts
- **embla-carousel-react 8.6.0** — carousel
- **input-otp 1.4.2** — OTP input

## Styling
- **Tailwind CSS 3.4.17** — utility-first CSS
- **tailwindcss-animate 1.0.7** — animation utilities
- **@tailwindcss/typography 0.5.16** (dev)
- **postcss 8.5.6** + **autoprefixer 10.4.21**
- Custom design tokens: `kpi.positive/negative/neutral`, `table.stripe/hover/header`, `sidebar.*`, shadow variables (`shadow-glow`)
- Font: **Plus Jakarta Sans** (custom font family)
- **class-variance-authority 0.7.1** — variant-based className generation
- **clsx 2.1.1** + **tailwind-merge 2.6.0** — conditional class merging

## Forms & Validation
- **react-hook-form 7.61.1**
- **@hookform/resolvers 3.10.0**
- **zod 3.25.76** — schema validation (used both in frontend and edge functions)

## Charts & Data Visualization
- **recharts 2.15.4** — primary charting library

## Animation
- **framer-motion 12.38.0** — motion animations

## Date Handling
- **date-fns 3.6.0**
- **react-day-picker 8.10.1** — date picker UI

## Theming
- **next-themes 0.3.0** — dark/light mode toggle

## Notifications / Toast
- **sonner 1.7.4** — toast notifications

## Export
- **xlsx 0.20.3** (from cdn.sheetjs.com) — Excel file generation

## Backend (BaaS)
- **@supabase/supabase-js 2.98.0** — client SDK
- Supabase project ID: `gionpsuunfkkzzjdubfy`
- Auth: session stored in `localStorage`, `autoRefreshToken: true`, `persistSession: true`

## Testing
- **vitest 3.2.4** — test runner
- **@testing-library/react 16.0.0** + **@testing-library/jest-dom 6.6.0**
- **jsdom 20.0.3** — DOM environment for tests

## Linting
- **eslint 9.32.0** + **typescript-eslint 8.38.0**
- **eslint-plugin-react-hooks 5.2.0**
- **eslint-plugin-react-refresh 0.4.20**

## Build Output (Vite manual chunks)
- `react-vendor`: react, react-dom, react-router-dom
- `supabase`: @supabase/supabase-js
- `charts`: recharts
- `motion`: framer-motion
- `query`: @tanstack/react-query
- `dates`: date-fns

## Dev Tooling
- **lovable-tagger 1.1.13** — component tagging in dev mode (Lovable.dev platform)
- **bun** — lockfile present (`bun.lock`, `bun.lockb`), though `package-lock.json` also present (npm used for CI)
