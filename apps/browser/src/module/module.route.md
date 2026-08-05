# Route conventions

Route files own URL-level composition and use TanStack Router's `createFileRoute`.
The virtual route map in `src/platform/routes.ts` owns the hierarchy; generated
`routeTree.gen.ts` is build output. Keep page behavior in the route component and
do not recreate routes manually in `main.tsx`. This document describes ownership
only and does not introduce executable `.route.md` lint behavior.
