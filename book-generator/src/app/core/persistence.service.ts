import { Injectable } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { map, switchMap, catchError, shareReplay } from 'rxjs/operators';

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
  private readonly DB_VERSION = 1;
  private readonly BOOKS_STORE = 'books';
  private readonly CHECKPOINTS_STORE = 'checkpoints';

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
   * Clear all data (for testing or reset)
   */
  clearAll(): Observable<void> {
    return this.getDb().pipe(
      switchMap(db => {
        const checkpointTransaction = db.transaction([this.CHECKPOINTS_STORE], 'readwrite');
        const checkpointStore = checkpointTransaction.objectStore(this.CHECKPOINTS_STORE);
        const clearCheckpoints$ = new Observable<void>(subscriber => {
          const request = checkpointStore.clear();
          request.onsuccess = () => {
            subscriber.next();
            subscriber.complete();
          };
          request.onerror = () => {
            subscriber.error(request.error);
          };
        });

        const bookTransaction = db.transaction([this.BOOKS_STORE], 'readwrite');
        const bookStore = bookTransaction.objectStore(this.BOOKS_STORE);
        const clearBooks$ = new Observable<void>(subscriber => {
          const request = bookStore.clear();
          request.onsuccess = () => {
            subscriber.next();
            subscriber.complete();
          };
          request.onerror = () => {
            subscriber.error(request.error);
          };
        });

        return new Observable<void>(subscriber => {
          clearCheckpoints$.subscribe({
            next: () => {
              clearBooks$.subscribe({
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
}
