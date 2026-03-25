import { Component, OnInit, inject, effect } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { BookConfig } from '../../models/book-config.model';
import { ApiService } from '../../core/api.service';
import { TranslationService } from '../../i18n/translation.service';

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
  
  configForm: FormGroup;
  currentStep = 0;
  isSubmitting = false;

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
    // Effect to reload translations when language changes
    effect(() => {
      // Access the language signal to create a dependency
      const _ = this.translationService.language();
      // Reload translations when language changes
      this.loadTranslations();
    });

    this.configForm = this.fb.group({
      // Model selection
      model: [''],

      // Step 1: Creative Settings
      title: ['', Validators.required],
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

    // Handle step query parameter (passed from generator page)
    this.route.queryParams.subscribe(params => {
      if (params['step']) {
        const stepNumber = parseInt(params['step'], 10);
        if (stepNumber >= 1 && stepNumber <= this.steps.length) {
          this.currentStep = stepNumber - 1; // Convert to 0-based index
        }
      }
    });

    // Load saved config if exists
    const savedConfig = localStorage.getItem('book-config');
    // Always get the selected model from localStorage (user's current choice in settings)
    const selectedModelFromStorage = localStorage.getItem('selected-model') || this.apiService.getDefaultModel().id;
    
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
      // Completed step
      return 'bg-brand-500 text-white shadow-md';
    } else if (stepNumber === this.currentStep) {
      // Current step
      return 'bg-brand-100 dark:bg-brand-900/50 text-brand-600 dark:text-brand-400 ring-2 ring-brand-500 shadow-md';
    } else {
      // Future step
      return 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400';
    }
  }

  /**
   * Translate form values from Polish to English for AI processing
   */
  private translateFormValuesToEnglish(formValue: any): any {
    if (this.translationService.isEnglish()) {
      return formValue;
    }

    // Translate dropdown values
    const translatedValue = {
      ...formValue,
      genre: this.translationService.translateDropdownToEnglish('genres', formValue.genre),
      style: this.translationService.translateDropdownToEnglish('writingStyles', formValue.style),
      tone: this.translationService.translateDropdownToEnglish('tones', formValue.tone),
      pov: this.translationService.translateDropdownToEnglish('povs', formValue.pov),
      tense: this.translationService.translateDropdownToEnglish('tenses', formValue.tense),
      audience: this.translationService.translateDropdownToEnglish('audiences', formValue.audience),
      worldType: this.translationService.translateDropdownToEnglish('worldTypes', formValue.worldType),
      targetLength: this.translationService.translateDropdownToEnglish('bookLengths', formValue.targetLength),
      chapterLength: this.translationService.translateDropdownToEnglish('chapterLengths', formValue.chapterLength),
      plotArchetype: this.translationService.translateDropdownToEnglish('plotArchetypes', formValue.plotArchetype),
      actStructure: this.translationService.translateDropdownToEnglish('actStructures', formValue.actStructure),
      protagonist: {
        ...formValue.protagonist,
        background: formValue.protagonist.background,
        motivations: formValue.protagonist.motivations,
        flaws: formValue.protagonist.flaws,
        arc: formValue.protagonist.arc
      },
      antagonist: {
        ...formValue.antagonist,
        background: formValue.antagonist.background,
        motivations: formValue.antagonist.motivations,
        flaws: formValue.antagonist.flaws,
        arc: formValue.antagonist.arc
      }
    };

    return translatedValue;
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
    
    // Build complete config with the selected model - always use localStorage value
    const currentSelectedModel = localStorage.getItem('selected-model') || this.apiService.getDefaultModel().id;
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
      this.isSubmitting = true;
      
      // Get form values
      const formValue = this.configForm.value;
      
      // Translate and save config
      this.saveConfigToStorage(formValue);

      // Navigate to generator
      setTimeout(() => {
        this.isSubmitting = false;
        this.router.navigate(['/generator']);
      }, 1000);
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
    return localStorage.getItem('selected-model') || this.apiService.getDefaultModel().id;
  }

  // Get selected model name for display
  getSelectedModelName(): string {
    const selectedModelId = localStorage.getItem('selected-model');
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

  // Random fill for testing - always generates shortest possible book
  fillRandom(): void {
    const randomFromArray = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    
    // Use English content for internal storage (AI needs English)
    // But display the translated values from the dropdown arrays
    const isPolish = this.translationService.isPolish();
    
    const randomTitlesEnglish = [
      'The Shadow of Eternity', 'Whispers in the Void', 'The Last Horizon',
      'Echoes of Tomorrow', 'The Crystal Kingdom', 'Beyond the Stars',
      'The Forgotten Path', 'Rise of the Phoenix', 'The Silent Storm',
      'Legends of the Deep'
    ];
    
    const randomTitlesPolish = [
      'Cień Wieczności', 'Szepty w Pustce', 'Ostatni Horyzont',
      'Echo Jutra', 'Królestwo Kryształów', 'Poza Gwiazdami',
      'Zapomniana Ścieżka', 'Wschód Feniksa', 'Cicha Burza',
      'Legendy Głębi'
    ];
    
    const randomNamesEnglish = [
      'Alex', 'Jordan', 'Morgan', 'Casey', 'Riley', 'Quinn', 'Avery', 'Sage',
      'Phoenix', 'River', 'Skyler', 'Dakota', 'Reese', 'Cameron', 'Taylor'
    ];
    
    const randomNamesPolish = [
      'Aleksandra', 'Marek', 'Piotr', 'Katarzyna', 'Michał', 'Anna',
      'Tomasz', 'Natalia', 'Jakub', 'Zofia', 'Hubert', 'Alicja', 'Igor', 'Maja'
    ];
    
    const randomBackgroundsEnglish = [
      'A former soldier haunted by the past, seeking redemption in a world that has forgotten peace.',
      'Born into nobility but cast out, now walking the path of the common folk to understand true power.',
      'A scholar who discovered forbidden knowledge and must now live on the run.',
      'Raised in isolation, they venture into the world to find their missing family.',
      'A healer with a dark secret - they can absorb others\' pain but at a terrible cost.',
      'Once a leader of men, now a wanderer seeking answers to an ancient mystery.'
    ];
    
    const randomBackgroundsPolish = [
      'Były żołnierz nękany przez przeszłość, szukający odkupienia w świecie, który zapomniał o pokoju.',
      'Urodzony w szlachcie, ale wypędzony, teraz podąża ścieżką zwykłych ludzi, by zrozumieć prawdziwą moc.',
      'Uczony, który odkrył zakazaną wiedzę i musi teraz żyć w ucieczce.',
      'Wychowany w izolacji, wyrusza w świat, by odnaleźć swoją zaginioną rodzinę.',
      'Uzdrowicielka z mroczną tajemnicą - może absorbować ból innych, ale za straszliwą cenę.',
      'Dawny przywódca ludzi, teraz wędrowiec szukający odpowiedzi na starożytną tajemnicę.'
    ];
    
    const randomMotivationsEnglish = [
      'To find lost loved ones and bring them home',
      'To uncover the truth about their mysterious past',
      'To protect the innocent from a growing darkness',
      'To prove themselves worthy of their heritage',
      'To find peace after years of conflict',
      'To master a dangerous power before it consumes them'
    ];
    
    const randomMotivationsPolish = [
      'Odnaleźć zaginionych bliskich i przyprowadzić ich do domu',
      'Odkryć prawdę o swojej tajemniczej przeszłości',
      'Chronić niewinnych przed rosnącym mrokiem',
      'Udowodnić, że są godni swojego dziedzictwa',
      'Znaleźć pokój po latach konfliktu',
      'Opanować niebezpieczną moc, zanim ich pochłonie'
    ];
    
    const randomFlawsEnglish = [
      'Cannot trust others easily, pushes away those who try to help',
      'Overly impulsive, acts before thinking through consequences',
      'Haunted by past failures, doubts their own abilities',
      'Too willing to sacrifice themselves for others',
      'Struggles with anger issues that cloud their judgment',
      'Fear of intimacy prevents forming deep connections'
    ];
    
    const randomFlawsPolish = [
      'Nie może łatwo zaufać innym, odpycha tych, którzy próbują pomóc',
      'Zbyt impulsywny, działa zanim przemyśli konsekwencje',
      'Nękany przez przeszłe porażki, wątpi we własne zdolności',
      'Zbyt skłonny do poświęcania się dla innych',
      'Zmaga się z problemami z złością, które przyćmiewają jego osąd',
      'Strach przed bliskością uniemożliwia nawiązywanie głębokich więzi'
    ];
    
    const randomArcsEnglish = [
      'From isolation to learning the power of connection and trust',
      'From self-doubt to embracing their true potential and leadership',
      'From revenge to understanding the true meaning of justice',
      'From fear to courage, facing the darkness within and without',
      'From loss to finding hope and purpose in helping others',
      'From recklessness to wisdom, learning to think before acting'
    ];
    
    const randomArcsPolish = [
      'Od izolacji do poznania mocy więzi i zaufania',
      'Od wątpliwości do przyjęcia swojego prawdziwego potencjału i przywództwa',
      'Od zemsty do zrozumienia prawdziwego znaczenia sprawiedliwości',
      'Od strachu do odwagi, stawiania czoła ciemności w środku i na zewnątrz',
      'Od straty do znalezienia nadziei i celu w pomaganiu innym',
      'Od lekkomyślności do mądrości, uczenia się myślenia przed działaniem'
    ];
    
    const randomThemesEnglish = [
      'Redemption, Love, Power',
      'Identity, Sacrifice, Hope',
      'Fate, Choice, Courage',
      'Betrayal, Loyalty, Growth',
      'Darkness, Light, Balance',
      'Memory, Truth, Forgiveness'
    ];
    
    const randomThemesPolish = [
      'Odkupienie, Miłość, Władza',
      'Tożsamość, Ofiara, Nadzieja',
      'Przeznaczenie, Wybór, Odwaga',
      'Zdrada, Lojalność, Rozwój',
      'Ciągłość, Światło, Równowaga',
      'Pamięć, Prawda, Wybaczenie'
    ];

    // Select content based on language
    const titles = isPolish ? randomTitlesPolish : randomTitlesEnglish;
    const names = isPolish ? randomNamesPolish : randomNamesEnglish;
    const backgrounds = isPolish ? randomBackgroundsPolish : randomBackgroundsEnglish;
    const motivations = isPolish ? randomMotivationsPolish : randomMotivationsEnglish;
    const flaws = isPolish ? randomFlawsPolish : randomFlawsEnglish;
    const arcs = isPolish ? randomArcsPolish : randomArcsEnglish;
    const themes = isPolish ? randomThemesPolish : randomThemesEnglish;

    // Step 0: Creative Settings - ALWAYS use shortest book options
    this.configForm.patchValue({
      title: randomFromArray(titles),
      genre: randomFromArray(this.genres),
      style: randomFromArray(this.writingStyles),
      tone: randomFromArray(this.tones),
      pov: randomFromArray(this.povs),
      tense: randomFromArray(this.tenses),
      audience: randomFromArray(this.audiences),
      themes: randomFromArray(themes),
      worldType: randomFromArray(this.worldTypes),
      // ALWAYS use shortest options to minimize chapter count
      targetLength: this.bookLengths[0],
      chapterLength: this.chapterLengths[0]
    });

    // Step 1: Characters
    this.configForm.patchValue({
      protagonist: {
        name: randomFromArray(names),
        role: 'Protagonist',
        age: Math.floor(Math.random() * 40) + 20,
        background: randomFromArray(backgrounds),
        motivations: randomFromArray(motivations),
        flaws: randomFromArray(flaws),
        arc: randomFromArray(arcs)
      },
      antagonist: {
        name: randomFromArray(names),
        role: 'Antagonist',
        age: Math.floor(Math.random() * 30) + 30,
        background: randomFromArray(backgrounds),
        motivations: randomFromArray(motivations),
        flaws: randomFromArray(flaws),
        arc: randomFromArray(arcs)
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
