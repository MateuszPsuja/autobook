import { Injectable } from '@angular/core';
import { Observable, from, of, throwError, forkJoin } from 'rxjs';
import { map, switchMap, catchError, shareReplay } from 'rxjs/operators';
import { BookCoverArt, CharacterReference } from './providers/illustration.types';

export interface BookMeta {
  id: string;
  title: string;
  createdAt: Date;
  lastModified: Date;
  status: string;
}

@Injectable({
  providedIn: 'root'
})
export class PersistenceService {
  private readonly DB_NAME = 'book-generator-db';
  private readonly DB_VERSION = 2;
  private readonly BOOKS_STORE = 'books';
  private readonly CHECKPOINTS_STORE = 'checkpoints';
  // v2: illustration caches. Reference images are keyed by
  // `${bookId}::${characterName}::${style}` so a style change
  // invalidates only that entry. Book covers are keyed by
  // `${bookId}::${side}::${style}` for the same reason.
  private readonly CHAR_REFS_STORE = 'character_references';
  private readonly COVERS_STORE = 'book_covers';

  // Lazy-initialized IndexedDB as Observable
  private db$: Observable<IDBDatabase> | null = null;

  constructor() {}

  /**
   * Get IndexedDB as Observable (lazy initialization)
   */
  private getDb(): Observable<IDBDatabase> {
    if (!this.db$) {
      this.db$ = this.initDb().pipe(
        shareReplay(1)
      );
    }
    return this.db$;
  }

  /**
   * Initialize IndexedDB
   */
  private initDb(): Observable<IDBDatabase> {
    return new Observable(subscriber => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        subscriber.error(request.error);
        subscriber.complete();
      };

      request.onsuccess = () => {
        const db = request.result;
        
        // Handle database upgrades
        db.onversionchange = () => {
          db.close();
        };
        
        subscriber.next(db);
        subscriber.complete();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        // Create books store
        if (!db.objectStoreNames.contains(this.BOOKS_STORE)) {
          const booksStore = db.createObjectStore(this.BOOKS_STORE, { keyPath: 'id' });
          booksStore.createIndex('title', 'title', { unique: false });
          booksStore.createIndex('createdAt', 'createdAt', { unique: false });
          booksStore.createIndex('lastModified', 'lastModified', { unique: false });
        }

        // Create checkpoints store
        if (!db.objectStoreNames.contains(this.CHECKPOINTS_STORE)) {
          const checkpointsStore = db.createObjectStore(this.CHECKPOINTS_STORE, { keyPath: 'bookId' });
          checkpointsStore.createIndex('lastModified', 'lastModified', { unique: false });
        }

        // v2: illustration caches (character reference portraits and
        // book covers). Both stores are keyed by a string `key` field
        // composed by the caller (e.g. `<bookId>::<character>::<style>`)
        // so the same store can hold multiple entries per book / character.
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(this.CHAR_REFS_STORE)) {
            db.createObjectStore(this.CHAR_REFS_STORE, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(this.COVERS_STORE)) {
            db.createObjectStore(this.COVERS_STORE, { keyPath: 'key' });
          }
        }
      };
    });
  }

  /**
   * Execute an IndexedDB transaction operation
   */
  private executeInTransaction<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<any>
  ): Observable<T> {
    return this.getDb().pipe(
      switchMap(db => {
        return new Observable<T>(subscriber => {
          const transaction = db.transaction([storeName], mode);
          const store = transaction.objectStore(storeName);
          
          transaction.onerror = () => {
            subscriber.error(transaction.error);
          };

          const request = operation(store);
          
          request.onsuccess = () => {
            subscriber.next(request.result);
            subscriber.complete();
          };
          
          request.onerror = (event) => {
            subscriber.error((event.target as IDBRequest<any>).error);
          };
        });
      })
    );
  }

  // ===== Character Reference Caching (v2) =====

  /**
   * Fetch a cached character reference portrait by its cache key.
   * Returns `null` when no entry exists or the underlying IndexedDB
   * call throws — callers treat both as "cache miss, regenerate".
   */
  getCharacterReference$(key: string): Observable<CharacterReference | null> {
    return this.executeInTransaction<{ key: string; base64: string; mimeType: 'image/jpeg' | 'image/png'; characterName: string } | undefined>(
      this.CHAR_REFS_STORE,
      'readonly',
      store => store.get(key)
    ).pipe(
      map(rec => rec ? {
        base64: rec.base64,
        mimeType: rec.mimeType,
        characterName: rec.characterName,
      } : null),
      catchError(() => of(null))
    );
  }

  /** Store a generated character reference portrait for reuse. */
  saveCharacterReference$(key: string, ref: CharacterReference): Observable<void> {
    const record = { key, base64: ref.base64, mimeType: ref.mimeType, characterName: ref.characterName };
    return this.executeInTransaction<void>(
      this.CHAR_REFS_STORE,
      'readwrite',
      store => store.put(record)
    ).pipe(
      map(() => void 0),
      catchError(() => of(void 0))
    );
  }

  // ===== Book Cover Caching (v2) =====

  /** Fetch a cached book cover (front or back) by its cache key. */
  getBookCover$(key: string): Observable<BookCoverArt | null> {
    return this.executeInTransaction<{ key: string; base64: string; mimeType: 'image/jpeg' | 'image/png'; side: 'front' | 'back' } | undefined>(
      this.COVERS_STORE,
      'readonly',
      store => store.get(key)
    ).pipe(
      map(rec => rec ? {
        base64: rec.base64,
        mimeType: rec.mimeType,
        side: rec.side,
      } : null),
      catchError(() => of(null))
    );
  }

  /** Store a generated book cover image for reuse. */
  saveBookCover$(key: string, art: BookCoverArt): Observable<void> {
    const record = { key, base64: art.base64, mimeType: art.mimeType, side: art.side };
    return this.executeInTransaction<void>(
      this.COVERS_STORE,
      'readwrite',
      store => store.put(record)
    ).pipe(
      map(() => void 0),
      catchError(() => of(void 0))
    );
  }

  // ===== Checkpoint Operations =====

  /**
   * Save a checkpoint of the book state
   */
  saveCheckpoint(bookId: string, state: any): Observable<void> {
    const checkpoint = {
      bookId,
      state,
      lastModified: new Date()
    };

    return this.executeInTransaction<void>(
      this.CHECKPOINTS_STORE,
      'readwrite',
      store => store.put(checkpoint)
    ).pipe(
      map(() => void 0)
    );
  }

  /**
   * Load a checkpoint for a book
   */
  loadCheckpoint(bookId: string): Observable<any | null> {
    return this.executeInTransaction<{ bookId: string; state: any; lastModified: Date } | undefined>(
      this.CHECKPOINTS_STORE,
      'readonly',
      store => store.get(bookId)
    ).pipe(
      map(checkpoint => checkpoint ? checkpoint.state : null)
    );
  }

  // ===== Book Operations =====

  /**
   * List all saved books
   */
  listBooks(): Observable<BookMeta[]> {
    return this.executeInTransaction<BookMeta[]>(
      this.BOOKS_STORE,
      'readonly',
      store => store.getAll()
    );
  }

  /**
   * Save book metadata
   */
  saveBookMeta(meta: BookMeta): Observable<void> {
    return this.executeInTransaction<void>(
      this.BOOKS_STORE,
      'readwrite',
      store => store.put(meta)
    ).pipe(
      map(() => void 0)
    );
  }

  /**
   * Delete a book and its checkpoint
   */
  deleteBook(bookId: string): Observable<void> {
    return this.getDb().pipe(
      switchMap(db => {
        // Delete checkpoint
        const checkpointTransaction = db.transaction([this.CHECKPOINTS_STORE], 'readwrite');
        const checkpointStore = checkpointTransaction.objectStore(this.CHECKPOINTS_STORE);
        const deleteCheckpoint$ = new Observable<void>(subscriber => {
          const request = checkpointStore.delete(bookId);
          request.onsuccess = () => {
            subscriber.next();
            subscriber.complete();
          };
          request.onerror = () => {
            subscriber.error(request.error);
          };
        });

        // Delete book metadata
        const bookTransaction = db.transaction([this.BOOKS_STORE], 'readwrite');
        const bookStore = bookTransaction.objectStore(this.BOOKS_STORE);
        const deleteBook$ = new Observable<void>(subscriber => {
          const request = bookStore.delete(bookId);
          request.onsuccess = () => {
            subscriber.next();
            subscriber.complete();
          };
          request.onerror = () => {
            subscriber.error(request.error);
          };
        });

        return new Observable<void>(subscriber => {
          deleteCheckpoint$.subscribe({
            next: () => {
              deleteBook$.subscribe({
                next: () => {
                  subscriber.next();
                  subscriber.complete();
                },
                error: (err) => subscriber.error(err)
              });
            },
            error: (err) => subscriber.error(err)
          });
        });
      }),
      map(() => void 0)
    );
  }

  /**
   * Clear all data (for testing or reset). All four stores are
   * cleared in independent transactions in parallel so a slow
   * or failing clear on one store doesn't block the others, and
   * each transaction gets a well-formed lifetime (request added
   * synchronously with transaction creation, no risk of
   * auto-commit before use).
   */
  clearAll(): Observable<void> {
    return forkJoin({
      checkpoints: this.executeInTransaction<void>(
        this.CHECKPOINTS_STORE,
        'readwrite',
        store => store.clear()
      ),
      books: this.executeInTransaction<void>(
        this.BOOKS_STORE,
        'readwrite',
        store => store.clear()
      ),
      characterReferences: this.executeInTransaction<void>(
        this.CHAR_REFS_STORE,
        'readwrite',
        store => store.clear()
      ),
      bookCovers: this.executeInTransaction<void>(
        this.COVERS_STORE,
        'readwrite',
        store => store.clear()
      )
    }).pipe(map(() => void 0));
  }
}
