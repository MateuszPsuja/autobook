import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PersistenceService } from './core/persistence.service';
import { BookStateService } from './book/state/book-state.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  protected title = 'book-generator';
  
  private persistenceService = inject(PersistenceService);
  private bookStateService = inject(BookStateService);
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    // Load saved checkpoint on app start using RxJS
    this.persistenceService.loadCheckpoint('current-book')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (savedState) => {
          if (savedState) {
            console.log('Full saved state keys:', Object.keys(savedState));
            console.log('Chapters in saved state:', savedState.chapters?.length);
            
            if (savedState.chapters && savedState.chapters.length > 0) {
              // Log first chapter details
              const firstChapter = savedState.chapters[0];
              console.log('First chapter content length:', firstChapter.content?.length);
              console.log('First chapter content preview:', firstChapter.content?.substring(0, 100));
              
              this.bookStateService.setChapters(savedState.chapters);
            }
            if (savedState.config) {
              this.bookStateService.setConfig(savedState.config);
            }
            if (savedState.blueprint) {
              this.bookStateService.setBlueprint(savedState.blueprint);
            }
            if (savedState.characterStore) {
              this.bookStateService.setCharacterStore(savedState.characterStore);
            }
            if (savedState.worldStateDoc) {
              this.bookStateService.setWorldStateDoc(savedState.worldStateDoc);
            }
            console.log('Loaded saved checkpoint with', savedState.chapters?.length || 0, 'chapters');
          } else {
            console.log('No saved checkpoint found');
          }
        },
        error: (error) => {
          console.error('Failed to load saved checkpoint:', error);
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
