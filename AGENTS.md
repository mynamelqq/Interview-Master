# Repository Guidelines

## Project Structure & Module Organization

Interview Master is an AI interview knowledge base built with Next.js 16, React 19, TypeScript, and Supabase.

- `app/`: App Router pages, API route handlers, layouts, and styles.
- `components/`: reading, editing, review, and workspace UI.
- `lib/`: AI integration, Supabase access, recommendations, and shared domain logic.
- `test/` and `tests/`: automated regression tests; both directories are active.
- `public/`: static assets and service worker resources.
- `supabase/migrations/`: ordered SQL schema and access-policy migrations.
- `scripts/`: asset-generation utilities.

## Build, Test, and Development Commands

- `npm install`: install dependencies using the existing npm lockfile.
- `npm run dev`: start the development server at `http://localhost:3000`.
- `npm run build`: create the production build.
- `npm start`: serve the production build locally.
- `npm run lint`: run ESLint with Next.js Core Web Vitals and TypeScript rules.
- `npm test`: run both test directories with Node's test runner and experimental TypeScript stripping.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, double quotes, and semicolons, following adjacent code. Use PascalCase for React components and kebab-case for component and utility filenames, such as `model-group-picker.tsx`. Use the `@/` alias for root-relative imports. Keep domain logic in `lib/` and UI behavior in `components/`.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`, with `*.test.mjs` filenames and descriptive behavior-based test names. Add regression coverage for changed domain rules, AI output normalization, recommendations, or offline behavior. No coverage threshold is configured. Run tests, lint, and a production build before submitting. Verify database policies and real AI generation separately with configured services; check mobile layouts for UI changes.

## Commit & Pull Request Guidelines

Recent commits use short, task-focused Chinese subjects, without a consistent Conventional Commits prefix. Follow that style and keep changes focused. Pull requests should explain the behavior change, validation performed, and any migration or configuration steps. Link relevant issues and include screenshots for visible UI changes.

## Security & Configuration

Copy `.env.example` to `.env.local`; never commit credentials. Keep AI keys server-side and preserve `AI_CONFIG_ENCRYPTION_KEY` once encrypted model groups exist. Apply new SQL migrations in filename order and maintain Supabase RLS protections.

## Agent-Specific Instructions

Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/`. This version has breaking API, convention, and file-structure changes; follow its deprecation notices rather than relying on prior Next.js knowledge.
