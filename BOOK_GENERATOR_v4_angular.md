# 📖 AI Book Generator — Angular Frontend Architecture v4

> A fully client-side Angular application orchestrating multiple AI agents to collaboratively write, critique, and refine publication-quality books. Zero backend. Zero infrastructure.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Angular 18+ (standalone components) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS v3 + custom design tokens |
| **State Management** | `BehaviorSubject<BookState>` in `BookStateService` |
| **Async / Orchestration** | RxJS + async/await |
| **Persistence** | IndexedDB via `idb` library |
| **API Key Storage** | `localStorage` (OpenRouter key) |
| **LLM Backend** | OpenRouter API (direct browser fetch) |
| **Export** | `jsPDF` (PDF), `epub-gen-memory` (EPUB), `docx` (DOCX) |

> Angular Material is **not used** — all UI is built with Tailwind utility classes for full design control and consistent dark mode support.

---

## Project Structure

```
src/
├── app/
│   ├── core/
│   │   ├── api.service.ts               # OpenRouter fetch wrapper + SSE streaming
│   │   ├── auth.service.ts              # API key read/write (localStorage)
│   │   └── persistence.service.ts       # IndexedDB checkpointing via idb
│   │
│   ├── book/
│   │   ├── state/
│   │   │   └── book-state.service.ts    # BehaviorSubject<BookState>, patch()
│   │   ├── orchestrator/
│   │   │   └── orchestrator.service.ts  # Chapter loop + conditional routing
│   │   ├── agents/
│   │   │   ├── architect.service.ts
│   │   │   ├── author.service.ts
│   │   │   ├── critic.service.ts
│   │   │   ├── reviser.service.ts
│   │   │   ├── character.service.ts
│   │   │   └── continuity.service.ts
│   │   └── prompts/
│   │       ├── architect.prompts.ts
│   │       ├── author.prompts.ts
│   │       ├── critic.prompts.ts
│   │       └── reviser.prompts.ts
│   │
│   ├── ui/
│   │   ├── shell/
│   │   │   ├── shell.component.ts       # App layout: sidebar + router outlet
│   │   │   └── sidebar.component.ts     # Navigation, project list, API key status
│   │   ├── config/
│   │   │   └── config.component.ts      # Multi-step wizard (Reactive Forms)
│   │   ├── generator/
│   │   │   └── generator.component.ts   # Agent pipeline view + streaming output
│   │   ├── viewer/
│   │   │   └── chapter-view.component.ts
│   │   └── export/
│   │       └── export.component.ts
│   │
│   ├── models/
│   │   ├── book-state.model.ts
│   │   ├── book-config.model.ts
│   │   ├── chapter.model.ts
│   │   ├── critique.model.ts
│   │   └── character.model.ts
│   │
│   └── shared/
│       ├── model-select/
│       │   └── model-select.component.ts  # Reusable OpenRouter model picker
│       └── pipes/
│           └── word-count.pipe.ts
```

---

## Tailwind Setup

### Installation
```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init
```

### `tailwind.config.js`
```js
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fffbeb',
          100: '#fef3c7',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          900: '#78350f',
        },
        surface: {
          DEFAULT: '#ffffff',
          secondary: '#f9fafb',
          tertiary: '#f3f4f6',
        }
      },
      fontFamily: {
        sans:  ['Inter Variable', 'system-ui', 'sans-serif'],
        serif: ['Lora', 'Georgia', 'serif'],
        mono:  ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),   // prose class for rendered book text
    require('@tailwindcss/forms'),         // form reset for selects and inputs
  ],
};
```

### Dark Mode
Dark mode is toggled by adding/removing the `dark` class on `<html>`. A `ThemeService` handles this and persists the preference to `localStorage`. Tailwind's `dark:` variant handles all color inversions — no separate stylesheet.

---

## UI / UX Design

### Layout — Sidebar + Main Panel
```
┌──────────────────────────────────────────────────────────────────────┐
│  ┌─────────────┐  ┌──────────────────────────────────────────────┐  │
│  │             │  │  Topbar: page title + primary action          │  │
│  │   Sidebar   │  ├──────────────────────────────────────────────┤  │
│  │  220px      │  │                                              │  │
│  │  fixed      │  │           Main Content Area                  │  │
│  │             │  │           (scrollable)                       │  │
│  │  - Logo     │  │                                              │  │
│  │  - Nav      │  │                                              │  │
│  │  - Projects │  │                                              │  │
│  │  - API key  │  │                                              │  │
│  └─────────────┘  └──────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

Tailwind classes for the shell:
```html
<div class="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
  <app-sidebar class="w-[220px] flex-shrink-0" />
  <main class="flex-1 flex flex-col overflow-hidden">
    <app-topbar />
    <div class="flex-1 overflow-y-auto p-6">
      <router-outlet />
    </div>
  </main>
</div>
```

---

### Step 1 — Config Page (Multi-Step Wizard)

Five steps navigated with a horizontal step indicator. Uses Angular Reactive Forms throughout.

**Step indicator:**
```html
<!-- active step: amber dot + bold label  -->
<!-- completed step: dark filled circle + checkmark  -->
<!-- future step: gray ring + muted label  -->
<div class="flex items-center gap-2 px-6 py-4 border-b border-gray-100 dark:border-gray-800">
  @for (step of steps; track step.id) {
    <div class="flex items-center gap-2 flex-1">
      <div [class]="stepNumClass(step)">{{ step.done ? '✓' : step.index }}</div>
      <span [class]="stepLabelClass(step)">{{ step.label }}</span>
      @if (!step.last) { <div class="flex-1 h-px bg-gray-200 dark:bg-gray-700 mx-2"></div> }
    </div>
  }
</div>
```

**Creative Settings fields (Step 1):**
```
Genre        Writing Style     Tone
POV          Tense             Target Audience
Target word count (range slider with preset pills: Short Story / Novella / Novel / Epic)
Chapter length (Short / Standard / Long toggle)
```

**Model Selection (Step 4) — single model for all agents:**
```html
<div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900">
  <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
    OpenRouter Model
  </label>
  <app-model-select [formControl]="modelControl" />

  <!-- Live model metadata card rendered below the select -->
  <div class="mt-3 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
    <span class="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">{{ selectedModel.provider }}</span>
    <span>{{ selectedModel.contextWindow }} context</span>
    <span class="ml-auto" [class.text-amber-600]="selectedModel.tier === 'premium'">
      {{ selectedModel.tier }}
    </span>
  </div>
</div>
```

---

### Model Select Component

Reusable dropdown backed by a curated list of OpenRouter models. Implements `ControlValueAccessor` so it works with Reactive Forms.

```typescript
// model-select.component.ts
export const OPENROUTER_MODELS: OpenRouterModel[] = [
  { id: 'anthropic/claude-3.5-sonnet',         name: 'Claude 3.5 Sonnet',   provider: 'Anthropic', tier: 'premium',  contextWindow: '200k', recommended: true  },
  { id: 'anthropic/claude-3-opus',             name: 'Claude 3 Opus',       provider: 'Anthropic', tier: 'premium',  contextWindow: '200k', recommended: false },
  { id: 'openai/gpt-4o',                       name: 'GPT-4o',              provider: 'OpenAI',    tier: 'premium',  contextWindow: '128k', recommended: false },
  { id: 'openai/gpt-4o-mini',                  name: 'GPT-4o Mini',         provider: 'OpenAI',    tier: 'budget',   contextWindow: '128k', recommended: false },
  { id: 'google/gemini-2.0-flash-exp',         name: 'Gemini 2.0 Flash',    provider: 'Google',    tier: 'budget',   contextWindow: '1M',   recommended: false },
  { id: 'meta-llama/llama-3.1-405b-instruct',  name: 'Llama 3.1 405B',      provider: 'Meta',      tier: 'standard', contextWindow: '128k', recommended: false },
  { id: 'mistralai/mistral-large',             name: 'Mistral Large',       provider: 'Mistral',   tier: 'standard', contextWindow: '128k', recommended: false },
  { id: 'deepseek/deepseek-r1',               name: 'DeepSeek R1',          provider: 'DeepSeek',  tier: 'budget',   contextWindow: '64k',  recommended: false },
  { id: 'cohere/command-r-plus',              name: 'Command R+',           provider: 'Cohere',    tier: 'standard', contextWindow: '128k', recommended: false },
];
```

The select renders model name + provider badge + recommended star. Selected model info card shows context window, tier, and a link to the model's OpenRouter page. One model is chosen globally and used by all agents.

---

### Step 2 — Generator Page

Three-column layout while generating:

```
┌──────────────────┬────────────────────────────┬──────────────┐
│  Agent Pipeline  │  Live Streaming Output      │  Progress    │
│                  │                             │              │
│  ● Architect ✓  │  Chapter 4: "The Signal"    │  4 / 22 ch   │
│  ● Author  ◌    │                             │  ████░░░░ 18%│
│  ● Critic  –    │  The rain had been falling  │              │
│  ● Reviser –    │  for three days without     │  Critique     │
│  ● Character –  │  pause, and Elena had       │  Prose    8.4 │
│  ● Continuity – │  stopped listening for      │  Pacing   7.9 │
│                  │  the sound of it.▌          │  Dialogue 9.1 │
└──────────────────┴────────────────────────────┴──────────────┘
```

**Agent cards** (left column) — each agent card shows:
- Status dot: idle (gray) / active (amber pulse) / done (green) / error (red)
- Agent name and one-line role
- Micro badge: `idle` / `running` / `done` / `skipped`

```html
<div [class]="agentCardClass(agent)"
     class="rounded-lg border p-3 transition-all duration-200">
  <div class="flex items-center justify-between mb-1">
    <span class="text-sm font-medium">{{ agent.name }}</span>
    <span [class]="statusDotClass(agent)" class="w-2 h-2 rounded-full"></span>
  </div>
  <p class="text-xs text-gray-400">{{ agent.description }}</p>
  <span [class]="chipClass(agent)" class="text-[10px] px-2 py-0.5 rounded-full mt-2 inline-block">
    {{ agent.status }}
  </span>
</div>
```

**Streaming output** (centre column):
- Token-by-token rendering using `async` pipe on an `Observable<string>`
- Blinking cursor shown while `status === 'writing'`
- Font: `font-serif` (Lora) for immersive reading feel
- Smooth auto-scroll to bottom via `ViewChild` + `scrollIntoView`

**Progress panel** (right column):
- Overall chapter progress bar
- Estimated remaining time
- Live critique score bars per dimension after each approved chapter

---

### Step 3 — Viewer Page

Two-column layout: chapter list left, reading panel right.

```
┌──────────────┬──────────────────────────────────────────────┐
│ Ch 1  8.6 ★  │  Chapter 2: A City of Silences               │
│ Ch 2  9.1 ★  │  3,124 words · Approved · Score 9.1          │
│ Ch 3  7.8    │  ─────────────────────────────────────────   │
│ Ch 4  8.4 ★  │  The city had a way of swallowing sound...   │
│              │                                              │
│              │  ┌─────────────────────────────────────┐    │
│              │  │  Critique Report                    │    │
│              │  │  Prose ████████░░ 8.4               │    │
│              │  │  Pacing ███████░░░ 7.1               │    │
│              │  └─────────────────────────────────────┘    │
└──────────────┴──────────────────────────────────────────────┘
```

The reading panel uses Tailwind Typography's `prose prose-lg dark:prose-invert` class for beautifully typeset book text with no additional CSS needed.

---

### Step 4 — Export Page

```
┌────────────────────────────────────────────────┐
│  Export Your Book                              │
│                                                │
│  Format                                        │
│  ○ PDF      ● EPUB    ○ DOCX    ○ Markdown     │
│                                                │
│  Options                                       │
│  ☑ Include chapter titles                      │
│  ☑ Include table of contents                   │
│  ☐ Include critique reports                    │
│  ☐ Include character profiles                  │
│                                                │
│  Chapter Range                                 │
│  All chapters  ▾                               │
│                                                │
│  [ Download PDF ]                              │
└────────────────────────────────────────────────┘
```

---

## PDF Export — `PdfExportService`

Uses `jsPDF` directly in the browser. No server, no headless Chrome.

```typescript
// pdf-export.service.ts
// Responsibilities:
// - Generate multi-page PDF from approved chapters
// - Cover page: title, author (optional), generation date
// - Table of contents with page numbers
// - Chapter title pages with decorative rule
// - Body text: Lora-style serif, 11pt, 1.6 leading, justified
// - Page numbers in footer
// - Optional appendix: critique scores table per chapter

// Key jsPDF methods used:
// doc.addPage()
// doc.setFont('times', 'normal')        ← closest to Lora available in jsPDF
// doc.setFontSize(11)
// doc.text(lines, x, y, { align: 'justify', maxWidth: contentWidth })
// doc.splitTextToSize(text, maxWidth)   ← word-wrap long paragraphs
// doc.save('book-title.pdf')            ← triggers browser download
```

### PDF Structure
```
Page 1    — Cover (title, subtitle, decorative rule)
Page 2    — Table of Contents (auto-generated from chapter list)
Page 3+   — Chapters
             ┌─ Chapter N title page (full page, centred)
             └─ Body text pages (margins: 25mm top/bottom, 20mm sides)
Last page — (optional) Critique Score Appendix
```

### Font strategy
`jsPDF` bundles only basic fonts. For better typography, embed a Base64-encoded subset of a free serif font (e.g. EB Garamond or Libre Baskerville from Google Fonts) using `doc.addFileToVFS()` and `doc.addFont()`. This keeps the PDF fully self-contained and visually close to the app's Lora serif used in the viewer.

---

## Core Services

### `ApiService`
```typescript
// POST to https://openrouter.ai/api/v1/chat/completions
// Headers:
//   Authorization: Bearer <key>
//   HTTP-Referer: http://localhost:4200
//   X-Title: Quillcraft
// Body: { model, messages, stream: true }
// Streaming: parse SSE chunks, emit tokens via Subject<string>
// Non-streaming: return full completion as string
```

### `AuthService`
```typescript
saveApiKey(key: string): void       // localStorage.setItem
getApiKey(): string | null          // localStorage.getItem
clearApiKey(): void
isConfigured(): boolean
```

### `BookStateService`
```typescript
state$ = new BehaviorSubject<BookState>(initialState);
patch(partial: Partial<BookState>): void   // immutable spread update
reset(): void
// Derived observables:
activeAgent$:    Observable<AgentType | null>
status$:         Observable<GenerationStatus>
chapters$:       Observable<Chapter[]>
currentDraft$:   Observable<ChapterDraft | null>
```

### `PersistenceService`
```typescript
saveCheckpoint(state: BookState): Promise<void>   // IndexedDB via idb
loadCheckpoint(bookId: string): Promise<BookState | null>
listBooks(): Promise<BookMeta[]>
deleteBook(bookId: string): Promise<void>
// Auto-save: called by OrchestratorService after every approved chapter
// Draft save: called every 30s during active writing
```

---

## Agent Services

Each agent has one public method. It receives only the state slices it needs — never injects `BookStateService` directly. The Orchestrator wires everything.

| Service | Method | Input | Output |
|---|---|---|---|
| `ArchitectService` | `generateBlueprint()` | `BookConfig` | `Observable<Blueprint>` |
| `AuthorService` | `writeChapter()` | `ChapterBrief`, `AuthorContext` | `Observable<ChapterDraft>` |
| `CriticService` | `evaluateChapter()` | `ChapterDraft`, `CriticContext` | `Observable<CritiqueReport>` |
| `ReviserService` | `reviseChapter()` | `ChapterDraft`, `CritiqueReport` | `Observable<ChapterDraft>` |
| `CharacterService` | `checkConsistency()` | `ChapterDraft`, `CharacterStore` | `Observable<CharacterCheckResult>` |
| `ContinuityService` | `checkContinuity()` | `Chapter[]`, `worldStateDoc` | `Observable<Issue[]>` |

---

## Orchestrator Service

```
orchestrate(config: BookConfig): void

Loop per chapter:
  1. callArchitect()         → blueprint (once, cached in state)
  2. callAuthor()            → draft (streaming → live UI update)
  3. callCharacterCheck()    → violations? → targeted revise
  4. callCritic()            → CritiqueReport
  5. score < 7 AND revisions < 3?
       YES → callReviser() → back to step 4
       NO  → approveChapter() → persist checkpoint
  6. chapter % 5 == 0?
       YES → callContinuity() → update worldStateDoc
  7. more chapters?
       YES → step 2
       NO  → finalAssembly() → enable Export button
```

### RxJS revision loop
```typescript
this.criticService.evaluate(draft, ctx).pipe(
  expand(critique =>
    critique.overallScore < 7 && this.revisionCount < 3
      ? this.reviserService.revise(draft, critique).pipe(
          tap(() => this.revisionCount++),
          switchMap(revised => this.criticService.evaluate(revised, ctx))
        )
      : EMPTY
  ),
  takeLast(1)
)
```

---

## Prompt Files

All prompts are pure TypeScript template functions in `/book/prompts/`. Zero magic strings in services.

```typescript
// author.prompts.ts
export const authorSystemPrompt = (config: BookConfig): string => `
You are a literary novelist writing in the ${config.style} style.
Tone: ${config.tone}. POV: ${config.pov}. Tense: ${config.tense}.
You never summarize when you can dramatize.
You show character through action and dialogue, not exposition.
You do not use clichés. You trust the reader.
`;

export const authorChapterPrompt = (brief: ChapterBrief, ctx: AuthorContext): string => `
Write Chapter ${brief.number}: "${brief.title}"
Previous chapter ended with: ${ctx.previousChapterClosing}
Chapter purpose: ${brief.plotBeat}
POV character: ${brief.povCharacter} — emotional state: ${brief.emotionalState}
Location: ${brief.location}
Key events: ${brief.keyEvents.join(', ')}
End with: ${brief.hookType}
Target: ${brief.targetWordCount} words. Full prose only. Do not summarize.
`;
```

---

## Data Models

### BookConfig
```typescript
interface BookConfig {
  title:          string;
  genre:          Genre;
  style:          WritingStyle;
  tone:           Tone;
  pov:            PointOfView;
  tense:          Tense;
  audience:       Audience;
  plotArchetype:  PlotArchetype;
  actStructure:   ActStructure;
  themes:         string[];           // max 5
  worldType:      WorldType;
  targetLength:   BookLength;
  chapterLength:  ChapterLength;
  protagonist:    CharacterProfile;
  antagonist:     CharacterProfile;
  hasPrologue:    boolean;
  hasEpilogue:    boolean;
  model:          string;             // single OpenRouter model ID for all agents
}
```

### BookState
```typescript
interface BookState {
  config:           BookConfig;
  blueprint:        Blueprint | null;
  chapters:         Chapter[];
  currentDraft:     ChapterDraft | null;
  characterStore:   Record<string, CharacterState>;
  worldStateDoc:    string;
  critique:         CritiqueReport | null;
  revisionCount:    number;
  continuityFlags:  Issue[];
  activeAgent:      AgentType | null;
  status:           GenerationStatus;
  error:            string | null;
}
```

### CritiqueReport
```typescript
interface CritiqueReport {
  scores: {
    prose:             number;   // 1–10
    pacing:            number;
    showVsTell:        number;
    dialogue:          number;
    continuity:        number;
    hookStrength:      number;
    thematicResonance: number;
  };
  overallScore: number;
  feedback:     string;
  mustFix:      string[];
  suggestions:  string[];
}
```

---

## Persistence Strategy

| Data | Storage | Trigger |
|---|---|---|
| OpenRouter API key | `localStorage` | On save in ConfigComponent |
| Theme preference | `localStorage` | On toggle |
| Full `BookState` | IndexedDB (`idb`) | After every approved chapter |
| In-progress draft | IndexedDB | Every 30 seconds |
| Exported files | Browser download | On user request |

On app load, `PersistenceService` checks IndexedDB for an existing checkpoint and prompts the user to resume.

---

## Quality Gates

| Gate | Trigger | Threshold | Action |
|---|---|---|---|
| Chapter quality | After every Author draft | Critic overall < 7 | Route to Reviser |
| Revision limit | Per chapter | 3 cycles | Mark chapter, continue |
| Character consistency | After every chapter | Any violation | Targeted revise |
| Continuity check | Every 5 chapters | Any contradiction | Queue fix |

---

## Output Formats

| Format | Library | Notes |
|---|---|---|
| **PDF** | `jsPDF` | Cover page, TOC, justified serif body, embedded font |
| **EPUB** | `epub-gen-memory` | Chapter-per-file, metadata, cover image slot |
| **DOCX** | `docx` | Styles mapped to Heading 1/Body Text |
| **Markdown** | Native string | Chapter headers + body |
| **Plain Text** | Native string | No formatting |

---

## Future Considerations

- **Reader Agent** — simulates target audience, flags confusing passages
- **Style blending** — "Cormac McCarthy meets Ursula Le Guin"
- **Human-in-the-loop** — pause after any chapter, edit manually, resume
- **Series mode** — persist world state and character store across books
- **PWA** — offline support, installable on desktop
- **Per-agent model override** — advanced mode exposing `AGENT_MODELS` config

---

*Architecture version 4.0 — Angular + Tailwind + OpenRouter + PDF*
