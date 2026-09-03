import { Injectable, inject } from '@angular/core';
import { Observable, of, defer, forkJoin } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { ProviderService } from './provider.service';
import { ApiService } from '../api.service';
import { PersistenceService } from '../persistence.service';
import { MinimaxImageService } from './minimax-image.service';
import { stripRunningWordCount } from '../../shared/utils/chapter-cleanup';
import {
  BookCoverArt,
  ChapterIllustration,
  CharacterReference,
  IllustrationRequest,
  IllustrationResult,
  IllustrationStyle,
} from './illustration.types';

// === Style prompts =========================================================

/**
 * Per-style suffix injected into every image prompt. Kept short and
 * visual-only — the model is image-01, not a text LLM, so the
 * illustration-specific vocabulary lives here in one place.
 */
const STYLE_PROMPTS: Record<IllustrationStyle, string> = {
  'auto': '', // resolved at call time from genre/tone
  'photorealistic': 'photorealistic, 35mm photograph, shallow depth of field',
  'watercolor': 'watercolor illustration, soft washes, paper texture',
  'oil-painting': 'oil painting, rich impasto, classical composition',
  'digital-art': 'digital art, vibrant colors, sharp details',
  'pencil-sketch': 'pencil sketch, crosshatching, monochrome',
  'anime': 'anime style, cel-shaded, expressive',
  // "comic" is ambiguous by itself: the model often defaults to B&W
  // ink art (Sin City / manga) when it sees "comic book panel, bold
  // inks, halftone shading" — especially for portraits with a plain
  // background (the character-reference step). When the same book
  // also gets a cover with no character reference, the model uses
  // scene colours instead and the two come out in different
  // palettes. The "full color, vibrant" suffix forces the model
  // toward coloured comic art for the cover, the chapter plates,
  // and the character reference alike.
  'comic': 'comic book panel, bold inks, halftone shading, full color, vibrant colors, vivid color palette',
};

/**
 * Heuristic mapping from genre/tone to a concrete style. No LLM call
 * here — the goal is "good enough without burning a chat completion per
 * chapter". Stable across the same book so a re-export uses the same
 * look as the first export.
 */
function resolveAutoStyle(genre: string, tone: string): IllustrationStyle {
  const g = (genre || '').toLowerCase();
  const t = (tone || '').toLowerCase();
  if (g.includes('fantasy') || g.includes('historical')) return 'oil-painting';
  if (g.includes('science fiction') || g.includes('sci-fi')) return 'digital-art';
  if (g.includes('mystery') || g.includes('thriller') || t.includes('dark') || t.includes('suspenseful')) return 'watercolor';
  if (g.includes('romance')) return 'watercolor';
  if (g.includes('horror')) return 'pencil-sketch';
  if (g.includes('literary')) return 'oil-painting';
  if (g.includes('young adult')) return 'digital-art';
  if (g.includes('non-fiction') || g.includes('biography')) return 'photorealistic';
  return 'digital-art';
}

function styleSuffixFor(style: IllustrationStyle, genre: string, tone: string): string {
  const resolved: IllustrationStyle = style === 'auto' ? resolveAutoStyle(genre, tone) : style;
  return STYLE_PROMPTS[resolved];
}

// === Small utilities =======================================================

/**
 * Tiny djb2 hash → 16 hex chars. We use it to derive a stable per-book
 * id from title + protagonist so character-reference caches survive a
 * reload of the same book but not a re-generation under a different
 * title.
 */
function djb2Hex(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  const u = hash >>> 0;
  const hex = u.toString(16).padStart(8, '0');
  // Mirror to 16 hex chars: deterministic, no salt needed because the
  // input (title + protagonist name) is already per-book unique in
  // practice.
  return (hex + hex.split('').reverse().join('')).slice(0, 16);
}

function bookIdOf(config: IllustrationRequest['config']): string {
  return djb2Hex(`${config.title || ''}::${config.protagonist?.name || ''}`);
}

/**
 * Discriminated union for the per-item work that the post-character
 * phase schedules. Using a tagged union keeps the result-aggregation
 * step below type-safe and free of `as any` casts.
 */
type WorkResult =
  | { kind: 'front'; r: { base64: string; mimeType: 'image/jpeg' | 'image/png' } | null }
  | { kind: 'back'; r: { base64: string; mimeType: 'image/jpeg' | 'image/png' } | null }
  | { kind: 'chapter'; id: string; ill: ChapterIllustration | null };

function truncate(s: string, n: number): string {
  if (!s) return s;
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '\u2026';
}

/**
 * Lightweight concurrency limiter: pipes each item through `fn` with at
 * most `limit` in-flight observables at a time. Preserves result order.
 * The implementation is intentionally simple: a queue of pending items
 * and a worker count. On any inner error we record `undefined` and
 * keep going so a single bad call doesn't abort the whole batch.
 */
function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Observable<R>
): Observable<R[]> {
  if (items.length === 0) return of([] as R[]);
  return defer(() => {
    const results: R[] = new Array(items.length);
    const pending = items.map((item, i) => ({ item, i }));
    let inFlight = 0;
    return new Observable<R[]>(subscriber => {
      const launch = () => {
        while (inFlight < limit && pending.length > 0) {
          const next = pending.shift()!;
          inFlight++;
          fn(next.item).subscribe({
            next: r => { results[next.i] = r; },
            error: () => { results[next.i] = undefined as unknown as R; },
            complete: () => {
              inFlight--;
              if (pending.length === 0 && inFlight === 0) {
                subscriber.next(results);
                subscriber.complete();
              } else {
                launch();
              }
            },
          });
        }
      };
      launch();
    });
  });
}

// === Service ================================================================

@Injectable({ providedIn: 'root' })
export class IllustrationService {
  private readonly providerService = inject(ProviderService);
  private readonly apiService = inject(ApiService);
  private readonly persistenceService = inject(PersistenceService);
  private readonly minimaxImage = inject(MinimaxImageService);

  /**
   * Top-level entry point. Returns an Observable so the caller can
   * `firstValueFrom` it and stay aligned with the rest of the async
   * surface in this app. All individual API calls return `null` on
   * failure, so the result is always a valid (possibly empty)
   * IllustrationResult and never throws.
   */
  generateAll$(req: IllustrationRequest): Observable<IllustrationResult> {
    if (this.providerService.getActiveProviderId() !== 'minimax') {
      return of({ chapterIllustrations: new Map(), totalCalls: 0, completedCalls: 0 });
    }
    if (!req.chapters || req.chapters.length === 0) {
      return of({ chapterIllustrations: new Map(), totalCalls: 0, completedCalls: 0 });
    }

    const bookId = bookIdOf(req.config);
    const styleSuffix = styleSuffixFor(req.style, req.config.genre, req.config.tone);

    // 1. Collect unique POV characters. The spec assumed chapters
    //    carry a `brief.povCharacter` field, but in this codebase
    //    the brief lives in `state.blueprint.chapters` and is not
    //    copied onto the chapter at approve time. We defensively
    //    read it from the chapter if it ever happens to be there
    //    (e.g. via a future runtime change), then fall back to
    //    pairing against the supplied brief map and finally to the
    //    protagonist / antagonist names.
    const povNames = new Set<string>();
    if (req.config.protagonist?.name) povNames.add(req.config.protagonist.name);
    if (req.config.antagonist?.name) povNames.add(req.config.antagonist.name);
    for (const ch of req.chapters) {
      const briefOnChapter = (ch as any).brief;
      if (briefOnChapter?.povCharacter) povNames.add(briefOnChapter.povCharacter);
    }
    const povList = Array.from(povNames);

    // 2. Themes — used as a fallback when the LLM scene call fails
    //    AND as ambient flavour in the final cover prompt. Kept
    //    short (≤ 3) to avoid over-constraining the model.
    const themes = (req.config.themes || []).slice(0, 3).join(', ') || 'atmospheric';

    // 3. Total call count. Two extra entries over the previous
    //    version: the cover front + back now each go through a
    //    scene-generation LLM call (same pattern as the chapter
    //    illustrations) so the cover images get a concrete visual
    //    brief instead of bare abstract themes. This is what makes
    //    them stylistically consistent with the chapter plates.
    //    Total = character refs + 2 cover scenes + 2 cover images
    //    + chapter illustrations (each chapter is 1 image + 1
    //    scene, counted as 1 in the existing pipeline).
    const totalCalls = povList.length + 4 + req.chapters.length;
    let completed = 0;
    const tick = () => {
      completed++;
      try { req.onProgress?.(completed, totalCalls); } catch { /* ignore */ }
    };

    // 4. Orchestrate the four phases. We do character-refs first
    //    so the chapter phase can attach `subject_reference` to
    //    every illustration that has a known POV. Cover scenes
    //    come next (so the cover image prompts can use the same
    //    `style + scene` structure as the chapter prompts). Cover
    //    images + chapter images run in parallel after that,
    //    sharing the concurrency-3 budget.
    return defer(() => {
      const characterWork = povList.map(name => defer(() =>
        this.ensureCharacterReference$(bookId, name, styleSuffix, req).pipe(
          map(ref => ({ name, ref })),
          catchError(() => of<{ name: string; ref: CharacterReference | null }>({ name, ref: null })),
          map(item => { tick(); return item; }),
        )
      ));

      return runWithConcurrency(characterWork, 3, src => src).pipe(
        switchMap(charResults => {
          const charRefs = new Map<string, CharacterReference>();
          for (const r of charResults) if (r && r.ref) charRefs.set(r.name, r.ref);

          // Cover scenes: same pattern as the chapter scene LLM
          // call. The front and back get different scene briefs so
          // they don't look like the same image. If the LLM call
          // fails on either, we fall back to the themes string so
          // the cover still ships.
          return forkJoin({
            frontScene: this.generateCoverScene$(req, 'front').pipe(
              tap(() => tick()),
              catchError(() => of(themes).pipe(tap(() => tick()))),
            ),
            backScene: this.generateCoverScene$(req, 'back').pipe(
              tap(() => tick()),
              catchError(() => of(themes).pipe(tap(() => tick()))),
            ),
          }).pipe(
            switchMap(({ frontScene, backScene }) => {
              // Cover prompts now follow the same `style + scene +
              // ambient + no-text` structure as the chapter
              // prompts, which is the consistency fix the user
              // asked for. The previous version had a "Book cover
              // art" prefix and abstract modifiers (cinematic /
              // muted / vertical composition) that biased the
              // model toward generic book covers and made them
              // visually diverge from the chapter plates.
              const frontPrompt = `${styleSuffix} illustration, ${frontScene}, ${themes}, no text, no letters, no words`;
              const backPrompt = `${styleSuffix} illustration, ${backScene}, ${themes}, no text, no letters, no words`;

              const coverWork = [
                defer(() => this.minimaxImage.generateImage$({ prompt: frontPrompt, aspectRatio: '3:4' })
                  .pipe(map(r => ({ kind: 'front' as const, r })))),
                defer(() => this.minimaxImage.generateImage$({ prompt: backPrompt, aspectRatio: '3:4' })
                  .pipe(map(r => ({ kind: 'back' as const, r })))),
              ];
              const chapterWork = req.chapters.map(ch => defer(() =>
                this.generateChapterIllustration$(ch, req, bookId, styleSuffix, charRefs).pipe(
                  map(ill => ({ kind: 'chapter' as const, id: ch.id, ill })),
                  catchError(() => of<{ kind: 'chapter'; id: string; ill: ChapterIllustration | null }>({ kind: 'chapter', id: ch.id, ill: null })),
                )
              ));

              const coverObs: Observable<WorkResult>[] = coverWork as unknown as Observable<WorkResult>[];
              const chapterObs: Observable<WorkResult>[] = chapterWork as unknown as Observable<WorkResult>[];
              const allWork: Observable<WorkResult>[] = [
                ...coverObs,
                ...chapterObs,
              ].map((item): Observable<WorkResult> => item.pipe(
                map((r: WorkResult) => { tick(); return r; }),
              ));
              return runWithConcurrency<Observable<WorkResult>, WorkResult>(allWork, 3, src => src).pipe(
                map(results => {
                  let coverArt: BookCoverArt | undefined;
                  let backCoverArt: BookCoverArt | undefined;
                  const chapterIllustrations = new Map<string, ChapterIllustration>();
                  for (const r of results) {
                    if (!r) continue;
                    if (r.kind === 'front' && r.r) {
                      coverArt = { base64: r.r.base64, mimeType: r.r.mimeType, side: 'front' };
                    } else if (r.kind === 'back' && r.r) {
                      backCoverArt = { base64: r.r.base64, mimeType: r.r.mimeType, side: 'back' };
                    } else if (r.kind === 'chapter' && r.ill) {
                      chapterIllustrations.set(r.id, r.ill);
                    }
                  }
                  return {
                    chapterIllustrations,
                    coverArt,
                    backCoverArt,
                    totalCalls,
                    completedCalls: completed,
                  };
                }),
              );
            }),
          );
        }),
        catchError(() => of({
          chapterIllustrations: new Map<string, ChapterIllustration>(),
          totalCalls,
          completedCalls: completed,
        })),
      );
    });
  }

  // === Cover scenes ========================================================

  /**
   * LLM-generated visual brief for the front or back cover. Mirrors
   * the chapter-scene pattern: ask the chat model for ONE concrete
   * sentence (setting, lighting, composition, mood) instead of
   * pushing raw abstract themes into the image model.
   *
   * The front prompt asks for an iconic, central-composition
   * moment — the visual that would sit on the front of a real
   * book. The back prompt asks for an atmospheric, quieter scene
   * that complements the front so the two covers don't look like
   * the same image with different colours.
   *
   * On any failure the caller falls back to the themes string, so
   * the cover still ships with *something* even if the LLM is
   * down.
   */
  private generateCoverScene$(req: IllustrationRequest, side: 'front' | 'back'): Observable<string> {
    const title = (req.config.title || '').trim() || 'this book';
    const themes = (req.config.themes || []).slice(0, 3).join(', ') || 'atmospheric';
    const genre = (req.config.genre || '').trim();
    const frontOrBack = side === 'front'
      ? 'one iconic, striking visual moment for the front cover, with a strong central composition'
      : 'one atmospheric, quieter visual for the back cover, more abstract and complementary to the front cover';

    const prompt = `Describe ${frontOrBack} of a ${genre || 'novel'} titled "${title}" (themes: ${themes}). ` +
      `Output ONE sentence (30 words or fewer) with only visual elements: setting, lighting, composition, mood. ` +
      `No abstract concepts, no character names, no text. Output only the sentence.`;

    return this.apiService.chatCompletion({
      model: this.resolveTextModel(),
      messages: [{ role: 'user', content: prompt }],
    }).pipe(
      map(resp => {
        const text = resp?.choices?.[0]?.message?.content?.trim() ?? '';
        if (!text) return themes;
        return text.split(/[.\n!?]/)[0].trim() + '.';
      }),
      catchError(() => of(themes)),
    );
  }

  // === Character references ================================================

  private ensureCharacterReference$(
    bookId: string,
    name: string,
    styleSuffix: string,
    req: IllustrationRequest,
  ): Observable<CharacterReference | null> {
    const cacheKey = `${bookId}::${name}::${styleSuffix || 'auto'}`;
    return this.persistenceService.getCharacterReference$(cacheKey).pipe(
      switchMap(cached => {
        if (cached && cached.base64) return of(cached);
        return this.generateCharacterReference$(name, styleSuffix, req).pipe(
          switchMap(ref => {
            if (!ref) return of(null);
            return this.persistenceService.saveCharacterReference$(cacheKey, ref).pipe(
              map(() => ref),
              catchError(() => of(ref)),
            );
          }),
        );
      }),
      catchError(() => of(null)),
    );
  }

  /**
   * Resolve the model id used for the M3 prompt-engineering passes
   * (character physical descriptions, per-chapter scene descriptions).
   * Falls back to the registry's recommended MiniMax model when the
   * user hasn't picked one yet. Without this, the earlier code passed
   * `model: ''` to `apiService.chatCompletion`, which the MiniMax API
   * rejects — silently killing every chapter illustration.
   */
  private resolveTextModel(): string {
    const selected = this.providerService.getSelectedModel('minimax');
    if (selected && selected.trim()) return selected;
    return 'MiniMax-M3';
  }

  private generateCharacterReference$(
    name: string,
    styleSuffix: string,
    req: IllustrationRequest,
  ): Observable<CharacterReference | null> {
    const state = req.characterStore?.[name];
    const known = state?.profile;
    const knownBackground = known?.background;
    const knownAge = known?.age;
    const profile = known
      ? `${name}${knownAge ? `, age ${knownAge}` : ''}${knownBackground ? `, ${knownBackground}` : ''}`
      : name;
    const descPrompt = known
      ? `Describe the physical appearance of a fictional character: ${profile}. Output ONE sentence (25 words or fewer) describing ONLY visual traits: face shape, hair color, build, distinguishing marks, age range. No clothing, no internal traits, no backstory. Output only the sentence.`
      : `Describe the physical appearance of a fictional character named ${name}. Output ONE sentence (25 words or fewer) describing only visual traits (face, hair, build, age range). No clothing, no backstory. Output only the sentence.`;
    return this.apiService.chatCompletion({
      model: this.resolveTextModel(),
      messages: [
        { role: 'user', content: descPrompt },
      ],
    }).pipe(
      map(resp => {
        const text = resp?.choices?.[0]?.message?.content?.trim() ?? '';
        if (!text) return null;
        const short = text.split(/[.\n!?]/)[0].trim();
        return short ? `${short}.` : null;
      }),
      catchError(() => of(null)),
      switchMap((desc: string | null) => {
        if (!desc) return of(null);
        const prompt = `Character portrait, ${styleSuffix}, ${desc}, plain background, head and shoulders, no text, no letters, no words`;
        return this.minimaxImage.generateImage$({ prompt, aspectRatio: '1:1' }).pipe(
          map(r => {
            if (!r) return null;
            return {
              base64: r.base64,
              mimeType: r.mimeType,
              characterName: name,
            };
          }),
        );
      }),
    );
  }

  // === Chapter illustrations ===============================================

  private generateChapterIllustration$(
    chapter: IllustrationRequest['chapters'][number],
    req: IllustrationRequest,
    bookId: string,
    styleSuffix: string,
    charRefs: Map<string, CharacterReference>,
  ): Observable<ChapterIllustration | null> {
    const cleanContent = stripRunningWordCount(chapter.content || '');
    const excerpt = cleanContent.slice(0, 600);
    // Defensive: the brief is not on the chapter type but the spec
    // assumed it would be. If a future change copies the brief onto
    // the chapter we can pick it up here.
    const briefOnChapter = (chapter as any).brief as { povCharacter?: string; location?: string } | undefined;
    const pov = briefOnChapter?.povCharacter;
    const location = briefOnChapter?.location || '';
    const ref = pov ? charRefs.get(pov) : undefined;

    return this.apiService.chatCompletion({
      model: this.resolveTextModel(),
      messages: [
        { role: 'user', content: `Chapter excerpt: ${excerpt}\n\nOutput ONE sentence (40 words or fewer) describing the single most visually striking moment. Output only the sentence.` },
      ],
    }).pipe(
      map(resp => {
        const text = resp?.choices?.[0]?.message?.content?.trim() ?? '';
        if (!text) return null;
        return text.split(/[.\n!?]/)[0].trim() + '.';
      }),
      catchError(() => of(null)),
      switchMap((scene: string | null) => {
        if (!scene) return of(null);
        const characterPart = ref && pov ? `${pov}, ` : '';
        const prompt = `${styleSuffix} illustration, ${scene}, ${characterPart}${location}, no text, no letters, no words`;
        return this.minimaxImage.generateImage$({
          prompt,
          subjectReferenceBase64: ref?.base64,
        }).pipe(
          map(r => {
            if (!r) return null;
            const caption = `Chapter ${chapter.number} \u00B7 ${truncate(scene.replace(/\.$/, ''), 60)}`;
            return {
              base64: r.base64,
              mimeType: r.mimeType,
              caption,
            };
          }),
        );
      }),
    );
  }
}
