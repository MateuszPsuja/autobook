import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { BookConfig } from '../../models/book-config.model';
import { ApiService } from '../../core/api.service';
import { BookStateService } from '../../book/state/book-state.service';
import { TranslationService } from '../../i18n/translation.service';
import { ProviderService } from '../../core/providers/provider.service';

@Component({
  selector: 'app-config',
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.scss'],
  standalone: true,
  imports: [ReactiveFormsModule]
})
export class ConfigComponent implements OnInit {
  protected translationService = inject(TranslationService);
  protected apiService = inject(ApiService);
  protected providerService = inject(ProviderService);
  private bookStateService = inject(BookStateService);

  configForm: FormGroup;
  currentStep = 0;

  // Form data
  bookConfig: BookConfig = {} as BookConfig;
  
  // Model selection
  selectedModel: string = '';

  // Options for dropdowns - will be populated from translations
  genres: string[] = [];
  writingStyles: string[] = [];
  tones: string[] = [];
  povs: string[] = [];
  tenses: string[] = [];
  audiences: string[] = [];
  plotArchetypes: string[] = [];
  actStructures: string[] = [];
  worldTypes: string[] = [];
  bookLengths: string[] = [];
  chapterLengths: string[] = [];

  steps: { number: number; label: string }[] = [];

  completedSteps: number[] = [];

  // TrackBy function for steps - prevents re-creation of step elements on change
  trackByStep(index: number, step: { number: number; label: string }): number {
    return step.number;
  }

  // TrackBy function for dropdown arrays - uses index as stable identifier
  trackByIndex(index: number): number {
    return index;
  }

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private route: ActivatedRoute
  ) {
    // The UI is English-only, so the dropdown labels and form values
    // are static. No effect needed — `loadTranslations()` is called
    // once from `ngOnInit` and that's it.

    this.configForm = this.fb.group({
      // Model selection
      model: [''],

      // Step 1: Creative Settings
      title: ['', Validators.required],
      plot: [''],
      genre: ['', Validators.required],
      style: ['', Validators.required],
      tone: ['', Validators.required],
      pov: ['', Validators.required],
      tense: ['', Validators.required],
      audience: ['', Validators.required],
      themes: ['', Validators.required],
      worldType: ['', Validators.required],
      targetLength: ['', Validators.required],
      chapterLength: ['', Validators.required],

      // Step 2: Characters
      protagonist: this.fb.group({
        name: ['', Validators.required],
        role: ['Protagonist'],
        age: [25, [Validators.required, Validators.min(1), Validators.max(100)]],
        background: ['', Validators.required],
        motivations: ['', Validators.required],
        flaws: ['', Validators.required],
        arc: ['', Validators.required]
      }),
      antagonist: this.fb.group({
        name: ['', Validators.required],
        role: ['Antagonist'],
        age: [35, [Validators.required, Validators.min(1), Validators.max(100)]],
        background: ['', Validators.required],
        motivations: ['', Validators.required],
        flaws: ['', Validators.required],
        arc: ['', Validators.required]
      }),

      // Step 3: Structure
      plotArchetype: ['', Validators.required],
      actStructure: ['', Validators.required],
      hasPrologue: [false],
      hasEpilogue: [false]
    });
  }

  ngOnInit(): void {
    // Load translations
    this.loadTranslations();
    
    // Redirect to settings if API key is not configured
    if (!this.apiService.isConfigured()) {
      this.router.navigate(['/settings']);
      return;
    }

    // Handle step query parameter (passed from generator page).
    // - step present and in range → jump to that step and mark all
    //   prior steps as completed (the user reached the generator,
    //   so the wizard was already finished).
    // - step absent → canonical entry point (e.g. sidebar menu).
    //   Reset to the first step so the menu always opens the
    //   wizard from the top, regardless of the step the user was
    //   on when they navigated away.
    this.route.queryParams.subscribe(params => {
      const stepParam = params['step'];
      if (stepParam) {
        const stepNumber = parseInt(stepParam, 10);
        if (stepNumber >= 1 && stepNumber <= this.steps.length) {
          this.currentStep = stepNumber - 1; // Convert to 0-based index
          for (let i = 1; i <= stepNumber; i++) {
            if (!this.completedSteps.includes(i)) {
              this.completedSteps.push(i);
            }
          }
        }
      } else {
        this.currentStep = 0;
        this.completedSteps = [];
      }
    });

    // Load saved config if exists
    const savedConfig = localStorage.getItem('book-config');
    // Always get the selected model from the active provider (user's current choice in settings)
    const selectedModelFromStorage = this.providerService.getSelectedModel() || this.apiService.getDefaultModel().id;
    
    if (savedConfig) {
      this.bookConfig = JSON.parse(savedConfig);
      // Patch form with saved config but always use the current selected model from localStorage
      this.configForm.patchValue({
        ...this.bookConfig,
        model: selectedModelFromStorage
      });
      this.selectedModel = selectedModelFromStorage;
    } else {
      // Initialize form with default model from localStorage
      this.configForm.patchValue({ model: selectedModelFromStorage });
      this.selectedModel = selectedModelFromStorage;
    }
  }

  /**
   * Update arrays in place to preserve array identity (avoids re-creation warning)
   */
  private updateArrayInPlace(existingArray: string[], newValues: string[]): void {
    // Clear existing array
    existingArray.length = 0;
    // Push all new values
    newValues.forEach(value => existingArray.push(value));
  }
  
  /**
   * Initialize or update the steps array in place
   */
  private initSteps(): void {
    const stepLabels = [
      this.t('config.creativeSettings'),
      this.t('config.characters'),
      this.t('config.structure'),
      this.t('config.review')
    ];
    
    // If steps is empty, initialize it
    if (this.steps.length === 0) {
      this.steps = stepLabels.map((label, index) => ({
        number: index + 1,
        label
      }));
    } else {
      // Update labels in place
      stepLabels.forEach((label, index) => {
        if (this.steps[index]) {
          this.steps[index].label = label;
        }
      });
    }
  }

  loadTranslations(): void {
    // Update dropdown arrays in place to preserve array identity
    this.updateArrayInPlace(this.genres, this.translationService.getArray('genres'));
    this.updateArrayInPlace(this.writingStyles, this.translationService.getArray('writingStyles'));
    this.updateArrayInPlace(this.tones, this.translationService.getArray('tones'));
    this.updateArrayInPlace(this.povs, this.translationService.getArray('povs'));
    this.updateArrayInPlace(this.tenses, this.translationService.getArray('tenses'));
    this.updateArrayInPlace(this.audiences, this.translationService.getArray('audiences'));
    this.updateArrayInPlace(this.plotArchetypes, this.translationService.getArray('plotArchetypes'));
    this.updateArrayInPlace(this.actStructures, this.translationService.getArray('actStructures'));
    this.updateArrayInPlace(this.worldTypes, this.translationService.getArray('worldTypes'));
    this.updateArrayInPlace(this.bookLengths, this.translationService.getArray('bookLengths'));
    this.updateArrayInPlace(this.chapterLengths, this.translationService.getArray('chapterLengths'));
    
    // Initialize or update steps
    this.initSteps();
    
    // Clear form values when language changes (since dropdown values change)
    this.clearFormValues();
  }
  
  /**
   * Clear form values when language changes since dropdown options change
   */
  private clearFormValues(): void {
    this.configForm.patchValue({
      title: '',
      plot: '',
      genre: '',
      style: '',
      tone: '',
      pov: '',
      tense: '',
      audience: '',
      themes: '',
      worldType: '',
      targetLength: '',
      chapterLength: '',
      protagonist: {
        name: '',
        background: '',
        motivations: '',
        flaws: '',
        arc: ''
      },
      antagonist: {
        name: '',
        background: '',
        motivations: '',
        flaws: '',
        arc: ''
      },
      plotArchetype: '',
      actStructure: ''
    });
    this.currentStep = 0;
    this.completedSteps = [];
  }

  t(key: string): string {
    return this.translationService.get(key);
  }

  // Step navigation
  nextStep(): void {
    if (this.currentStep < this.steps.length - 1) {
      if (!this.completedSteps.includes(this.currentStep + 1)) {
        this.completedSteps.push(this.currentStep + 1);
      }
      this.currentStep++;
    }
  }

  prevStep(): void {
    if (this.currentStep > 0) {
      this.currentStep--;
    }
  }

  /** Template-friendly alias. */
  previousStep(): void {
    this.prevStep();
  }

  /** Current step's display label, used by the topbar's "now in: …" eyebrow. */
  getCurrentStepLabel(): string {
    return this.steps[this.currentStep]?.label ?? '';
  }

  goToStep(stepNumber: number): void {
    const stepIndex = stepNumber - 1;
    // Can only go to completed steps or the current step
    if (stepIndex <= this.currentStep || this.completedSteps.includes(stepIndex)) {
      this.currentStep = stepIndex;
    }
  }

  isStepCompleted(stepIndex: number): boolean {
    return this.completedSteps.includes(stepIndex + 1);
  }

  getStepClass(stepNumber: number): string {
    if (stepNumber < this.currentStep || this.completedSteps.includes(stepNumber)) {
      // Completed: orange-tinted disc, thin orange ring, check icon visible.
      return 'bg-accent-500/15 text-accent-600 dark:text-accent-300 border-2 border-accent-500/40';
    } else if (stepNumber === this.currentStep) {
      // Current: solid orange disc with a static glow. No animation —
      // the user asked to keep this steady so it doesn't read as
      // a notification ping.
      return 'bg-accent-500 text-white border-2 border-accent-500 shadow-glow-accent';
    } else {
      // Future: sunken disc, faint border, muted text.
      return 'bg-surface-sunken text-surface-subtle border-2 border-surface-border';
    }
  }

  /**
   * The config form is now English-only (the UI is English-only too),
   * so the form values are already in English when they reach this
   * method. The function is kept as a no-op so the storage code can
   * keep calling it without a special case.
   */
  private translateFormValuesToEnglish(formValue: any): any {
    return formValue;
  }

  /**
   * Save config to localStorage (internal storage is always in English for AI)
   */
  private saveConfigToStorage(formValue: any): void {
    // Convert themes to array (handle both string input and existing array)
    let themesArray: string[];
    if (Array.isArray(formValue.themes)) {
      themesArray = formValue.themes;
    } else if (formValue.themes && typeof formValue.themes === 'string') {
      themesArray = formValue.themes.split(',').map((t: string) => t.trim()).filter((t: string) => t);
    } else {
      themesArray = [];
    }

    // Translate dropdown values from Polish to English
    const translatedFormValue = this.translateFormValuesToEnglish(formValue);
    
    // Build complete config with the selected model - always use the active provider's choice
    const currentSelectedModel = this.providerService.getSelectedModel() || this.apiService.getDefaultModel().id;
    this.bookConfig = {
      ...translatedFormValue,
      themes: themesArray,
      protagonist: { ...translatedFormValue.protagonist, role: 'Protagonist' },
      antagonist: { ...translatedFormValue.antagonist, role: 'Antagonist' },
      model: currentSelectedModel
    };

    // Save to localStorage (internally always in English)
    localStorage.setItem('book-config', JSON.stringify(this.bookConfig));
  }

  // Form submission
  onSubmit(): void {
    if (this.configForm.valid) {
      // Get form values
      const formValue = this.configForm.value;

      // Translate and save config
      this.saveConfigToStorage(formValue);

      // Navigate to generator. The form data is local-only at this
      // point (localStorage write + in-memory translation), so
      // there's nothing async to wait for — earlier revisions
      // wrapped the navigation in a 1s setTimeout "for loading
      // state", but `isSubmitting` was never read by the template
      // and the delay just made the button feel sluggish.
      this.router.navigate(['/generator']);
    }
  }

  // Utility methods
  get currentStepData() {
    return this.steps[this.currentStep];
  }

  get isLastStep(): boolean {
    return this.currentStep === this.steps.length - 1;
  }

  get isFirstStep(): boolean {
    return this.currentStep === 0;
  }

  get isConfigured(): boolean {
    // This is now always true since we redirect if not configured
    return this.apiService.isConfigured();
  }

  // Character form getters
  get protagonistForm() {
    return this.configForm.get('protagonist') as FormGroup;
  }

  get antagonistForm() {
    return this.configForm.get('antagonist') as FormGroup;
  }

  // Get selected model ID
  getSelectedModel(): string {
    return this.providerService.getSelectedModel() || this.apiService.getDefaultModel().id;
  }

  // Get selected model name for display
  getSelectedModelName(): string {
    const selectedModelId = this.providerService.getSelectedModel();
    if (!selectedModelId) {
      return this.apiService.getDefaultModel().name;
    }
    
    // Try to find in fallback models first
    const model = this.apiService.getModelById(selectedModelId);
    if (model) {
      return model.name;
    }
    
    // If not found in fallback, extract a readable name from the ID
    const parts = selectedModelId.split('/');
    if (parts.length >= 2) {
      let modelSlug = parts[1];
      modelSlug = modelSlug.replace(/:.*$/, '');
      const words = modelSlug.split('-').map(word => {
        if (/^\d+$/.test(word)) {
          return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      });
      return words.join(' ');
    }
    return selectedModelId;
  }

  // Validate only the current step

  isCurrentStepValid(): boolean {
    switch (this.currentStep) {
      case 0: // Creative Settings
        return !!(this.configForm.get('title')?.value &&
          this.configForm.get('genre')?.value &&
          this.configForm.get('style')?.value &&
          this.configForm.get('tone')?.value &&
          this.configForm.get('pov')?.value &&
          this.configForm.get('tense')?.value &&
          this.configForm.get('audience')?.value &&
          this.configForm.get('themes')?.value &&
          this.configForm.get('worldType')?.value &&
          this.configForm.get('targetLength')?.value &&
          this.configForm.get('chapterLength')?.value);
      case 1: // Characters
        return this.protagonistForm?.valid && this.antagonistForm?.valid;
      case 2: // Structure
        return !!(this.configForm.get('plotArchetype')?.value &&
          this.configForm.get('actStructure')?.value);
      default:
        return true;
    }
  }

  // Navigate to generator page
  goToGenerator(): void {
    // First save the current form state to localStorage (with translation if needed)
    if (this.configForm.valid) {
      this.saveConfigToStorage(this.configForm.value);
    }
    
    // Navigate to generator
    this.router.navigate(['/generator']);
  }

  // Random fill for testing - always generates shortest possible book.
  // Also clears any in-progress book state (chapters, blueprint, draft,
  // critique, skipped list) so a new generation won't be contaminated
  // by leftover data from a previous run.
  fillRandom(): void {
    this.bookStateService.reset();

    const randomFromArray = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

    // Pick two distinct elements from an array (guaranteed different).
    // Used so the protagonist and antagonist never get the same name.
    const pickTwoDistinct = <T>(arr: T[]): [T, T] => {
      const i = Math.floor(Math.random() * arr.length);
      let j = Math.floor(Math.random() * (arr.length - 1));
      if (j >= i) j++;
      return [arr[i], arr[j]];
    };

    // The UI is English-only, so all the seed content is in English.
    const randomTitles = [
      'The Shadow of Eternity', 'Whispers in the Void', 'The Last Horizon',
      'Echoes of Tomorrow', 'The Crystal Kingdom', 'Beyond the Stars',
      'The Forgotten Path', 'Rise of the Phoenix', 'The Silent Storm',
      'Legends of the Deep'
    ];

    const randomNames = [
      'Alex', 'Jordan', 'Morgan', 'Casey', 'Riley', 'Quinn', 'Avery', 'Sage',
      'Phoenix', 'River', 'Skyler', 'Dakota', 'Reese', 'Cameron', 'Taylor'
    ];

    const randomBackgrounds = [
      'A former soldier haunted by the past, seeking redemption in a world that has forgotten peace.',
      'Born into nobility but cast out, now walking the path of the common folk to understand true power.',
      'A scholar who discovered forbidden knowledge and must now live on the run.',
      'Raised in isolation, they venture into the world to find their missing family.',
      'A healer with a dark secret - they can absorb others\' pain but at a terrible cost.',
      'Once a leader of men, now a wanderer seeking answers to an ancient mystery.'
    ];

    const randomMotivations = [
      'To find lost loved ones and bring them home',
      'To uncover the truth about their mysterious past',
      'To protect the innocent from a growing darkness',
      'To prove themselves worthy of their heritage',
      'To find peace after years of conflict',
      'To master a dangerous power before it consumes them'
    ];

    const randomFlaws = [
      'Cannot trust others easily, pushes away those who try to help',
      'Overly impulsive, acts before thinking through consequences',
      'Haunted by past failures, doubts their own abilities',
      'Too willing to sacrifice themselves for others',
      'Struggles with anger issues that cloud their judgment',
      'Fear of intimacy prevents forming deep connections'
    ];

    const randomArcs = [
      'From isolation to learning the power of connection and trust',
      'From self-doubt to embracing their true potential and leadership',
      'From revenge to understanding the true meaning of justice',
      'From fear to courage, facing the darkness within and without',
      'From loss to finding hope and purpose in helping others',
      'From recklessness to wisdom, learning to think before acting'
    ];

    const randomThemes = [
      'Redemption, Love, Power',
      'Identity, Sacrifice, Hope',
      'Fate, Choice, Courage',
      'Betrayal, Loyalty, Growth',
      'Darkness, Light, Balance',
      'Memory, Truth, Forgiveness'
    ];

    // Step 0: Creative Settings - ALWAYS use shortest book options
    this.configForm.patchValue({
      title: randomFromArray(randomTitles),
      genre: randomFromArray(this.genres),
      style: randomFromArray(this.writingStyles),
      tone: randomFromArray(this.tones),
      pov: randomFromArray(this.povs),
      tense: randomFromArray(this.tenses),
      audience: randomFromArray(this.audiences),
      themes: randomFromArray(randomThemes),
      worldType: randomFromArray(this.worldTypes),
      // ALWAYS use shortest options to minimize chapter count
      targetLength: this.bookLengths[0],
      chapterLength: this.chapterLengths[0]
    });

    // Step 1: Characters
    const [protagonistName, antagonistName] = pickTwoDistinct(randomNames);
    this.configForm.patchValue({
      protagonist: {
        name: protagonistName,
        role: 'Protagonist',
        age: Math.floor(Math.random() * 40) + 20,
        background: randomFromArray(randomBackgrounds),
        motivations: randomFromArray(randomMotivations),
        flaws: randomFromArray(randomFlaws),
        arc: randomFromArray(randomArcs)
      },
      antagonist: {
        name: antagonistName,
        role: 'Antagonist',
        age: Math.floor(Math.random() * 30) + 30,
        background: randomFromArray(randomBackgrounds),
        motivations: randomFromArray(randomMotivations),
        flaws: randomFromArray(randomFlaws),
        arc: randomFromArray(randomArcs)
      }
    });

    // Step 2: Structure - NO prologue/epilogue to minimize chapters
    this.configForm.patchValue({
      plotArchetype: randomFromArray(this.plotArchetypes),
      actStructure: randomFromArray(this.actStructures),
      hasPrologue: false,
      hasEpilogue: false
    });
  }
}
