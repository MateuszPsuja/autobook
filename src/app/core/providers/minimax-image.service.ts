import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ProviderService } from './provider.service';
import { ApiService } from '../api.service';
import { getProvider } from './providers';
import { sniffImageFormat } from '../../shared/utils/image-bytes';

export interface MinimaxImageResult {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png';
}

export interface MinimaxImageArgs {
  prompt: string;
  /** raw base64, no `data:` prefix */
  subjectReferenceBase64?: string;
  aspectRatio?: '16:9' | '1:1' | '2:3' | '3:2' | '3:4' | '4:3';
}

/**
 * Thin wrapper over the MiniMax image-01 endpoint. The same base URL as
 * chat completions is used (it lives behind the same dev-server proxy at
 * `/api/minimax/v1`), so we resolve it through `ApiService.resolveBaseUrl`
 * to get the same URL the chat-completions path uses — that means the
 * dev-server proxy in `proxy.conf.json` kicks in correctly and we don't
 * blow up on CORS in `npm start`.
 *
 * Going through `ProviderService.getBaseUrl()` directly would have been
 * wrong: that helper returns `provider.baseUrl` (the direct upstream
 * URL) when no override is set, which bypasses the proxy. Image gen
 * would 200 in prod and silently CORS-fail in dev.
 *
 * All errors collapse to `of(null)` so the caller can treat generation
 * failures as "no image for this item" instead of having to wrap every
 * call in a try/catch. Progress reporting stays accurate because the
 * caller always increments its counter on completion regardless of
 * whether the result is non-null.
 */
@Injectable({ providedIn: 'root' })
export class MinimaxImageService {
  private readonly providerService = inject(ProviderService);
  private readonly apiService = inject(ApiService);

  generateImage$(args: MinimaxImageArgs): Observable<MinimaxImageResult | null> {
    if (this.providerService.getActiveProviderId() !== 'minimax') {
      return of(null);
    }
    const provider = getProvider('minimax');
    if (!provider) {
      return of(null);
    }
    const baseUrl = this.apiService.resolveBaseUrl(provider);
    const apiKey = this.providerService.getApiKey('minimax');
    if (!baseUrl || !apiKey) {
      return of(null);
    }
    const url = `${baseUrl.replace(/\/+$/, '')}/image_generation`;
    const body: Record<string, unknown> = {
      model: 'image-01',
      prompt: args.prompt,
      response_format: 'base64',
      aspect_ratio: args.aspectRatio ?? '16:9',
      n: 1,
    };
    if (args.subjectReferenceBase64) {
      body['subject_reference'] = [{
        type: 'character',
        image_file: `data:image/jpeg;base64,${args.subjectReferenceBase64}`,
      }];
    }

    return new Observable<MinimaxImageResult | null>(subscriber => {
      const controller = new AbortController();
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
        .then(async response => {
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            console.error(`MiniMax image gen failed (${response.status}):`, text);
            subscriber.next(null);
            subscriber.complete();
            return;
          }
          const data = await response.json().catch(() => null) as
            | { data?: { image_base64?: unknown; images?: unknown }; image_base64?: unknown; images?: unknown }
            | null;
          // The documented response shape is
          //   `{ data: { image_base64: string[] } }`
          // but we tolerate a few common variations: the array might be
          // `images`, it might be at the top level (no `data` wrapper),
          // or it might be a single string instead of an array. Whichever
          // shape comes back, we just need the first non-empty base64
          // string we can find.
          const candidates: unknown[] = [
            data?.data?.image_base64,
            data?.data?.images,
            data?.image_base64,
            data?.images,
          ];
          let b64: string | undefined;
          for (const c of candidates) {
            if (Array.isArray(c) && typeof c[0] === 'string' && c[0].length > 0) {
              b64 = c[0];
              break;
            }
            if (typeof c === 'string' && c.length > 0) {
              b64 = c;
              break;
            }
          }
          if (!b64) {
            console.warn('MiniMax image gen: response had no base64 image in any known field', data);
            subscriber.next(null);
            subscriber.complete();
            return;
          }
          const mimeType = detectImageMime(b64);
          console.log(
            `MiniMax image gen OK: ${b64.length} chars of base64, ` +
            `detected=${mimeType}, head="${b64.slice(0, 24)}…", aspect=${args.aspectRatio ?? '16:9'}`
          );
          subscriber.next({ base64: b64, mimeType });
          subscriber.complete();
        })
        .catch(err => {
          console.error('MiniMax image gen network error:', err);
          subscriber.next(null);
          subscriber.complete();
        });
      return () => controller.abort();
    }).pipe(
      catchError(() => of(null)),
      map(r => r ?? null),
    );
  }
}

/**
 * pdfmake 0.2.7 has poor support for WebP and GIF, so the PDF path
 * collapses both to PNG/JPEG via the shared sniffer. The EPUB path
 * calls `sniffImageFormat` directly so it gets the real format.
 */
function detectImageMime(b64: string): MinimaxImageResult['mimeType'] {
  const { mime } = sniffImageFormat(b64);
  if (mime === 'image/webp' || mime === 'image/gif') return 'image/jpeg';
  return mime;
}
