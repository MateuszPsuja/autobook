# AutoBook

AutoBook is an Angular application that orchestrates AI agents to design a story blueprint and generate chapter content, evaluate it, and export the result in multiple formats (PDF/EPUB/DOCX/Markdown).

This README covers quick setup, development commands, testing, and the included DejaVu Sans font licensing (font is bundled for consistent exports).

## Quick Start

Prerequisites:

- Node.js 18+ and npm
- Angular CLI (optional, install with `npm i -g @angular/cli`)

Clone and run locally:

```bash
git clone https://github.com/MateuszPsuja/autobook.git
cd autobook
npm install
npm start
# open http://localhost:4200/
```

Available npm scripts (from `package.json`):

- `npm start` — runs `ng serve` (development server)
- `npm run build` — runs `ng build` (production build)
- `npm run watch` — builds in watch mode
- `npm test` — runs unit tests (Karma + Jasmine)

## Tests

Run unit tests:

```bash
npm test
```

The test runner is configured with Karma and Chrome.

## Notes

- The app expects an API key for AI generation (configured in Settings). See the UI Settings page to enter your OpenRouter key or other provider credentials.
