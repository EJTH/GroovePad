# Build & Development

## Requirements

- Node.js 22
- npm

## Set up the project

```sh
git clone https://github.com/EJTH/GroovePad.git
cd GroovePad
npm ci
```

## Run locally

```sh
npm run dev
```

Vite prints the local development URL when the server starts.

## Test and build

Run the test suite:

```sh
npm test
```

Type-check and create a production build:

```sh
npm run build
```

The generated site is written to `dist/`. To serve that build locally:

```sh
npm run preview
```

For a production-like offline check, open the preview site while online first, then test a later launch with the browser offline. The development server is not a substitute for testing the built service worker.

## Project layout

- `src/` contains the application and its interface components.
- `public/` contains static assets copied into the built site.
- `templates/` contains the default project template.
- `docs/` contains the user manual and this guide.
- `vite.config.ts` configures the app build and Progressive Web App behavior.
