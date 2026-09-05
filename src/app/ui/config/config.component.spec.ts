import { TestBed } from '@angular/core/testing';
import { ConfigComponent } from './config.component';
import { TranslationService } from '../../i18n/translation.service';
import { ApiService } from '../../core/api.service';
import { ProviderService } from '../../core/providers/provider.service';
import { BookStateService } from '../../book/state/book-state.service';
import { ActivatedRoute, Router } from '@angular/router';
import { BookConfig, CharacterProfile } from '../../models/book-config.model';

describe('ConfigComponent', () => {
  it('should be truthy', () => {
    expect(ConfigComponent).toBeTruthy();
  });

  /**
   * Build a fresh ConfigComponent with a TestBed that has all the
   * constructor's services mocked. `savedConfig` controls what the
   * localStorage spy returns in the constructor — pass a JSON
   * string to simulate a saved book, or null for a clean slate.
   * TestBed is reset between builds so each test gets a fresh
   * component instance, and the localStorage spy is set up here
   * (TestBed.inject does NOT call ngOnInit, so callers that need
   * the lifecycle hook must invoke it explicitly).
   */
  const buildComponent = (savedConfig: string | null = null): ConfigComponent => {
    spyOn(localStorage, 'getItem').and.returnValue(savedConfig);
    spyOn(localStorage, 'setItem');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ConfigComponent,
        { provide: TranslationService, useValue: { get: (k: string) => k, getArray: () => [] } },
        { provide: ApiService, useValue: { isConfigured: () => true, getDefaultModel: () => ({ id: 'm', name: 'M', contextWindow: '128k', contextWindowNum: 128000 }), getModelById: () => null } },
        { provide: ProviderService, useValue: { getSelectedModel: () => 'm' } },
        { provide: BookStateService, useValue: { reset: () => {} } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: ActivatedRoute, useValue: { queryParams: { subscribe: () => ({ unsubscribe: () => {} }) } } },
      ],
    });
    return TestBed.inject(ConfigComponent);
  };

  describe('Supporting characters form array', () => {
    it('starts with an empty supporting-characters array', () => {
      const component = buildComponent();
      expect(component.supportingCharactersForm.length).toBe(0);
    });

    it('addSupportingCharacter appends a new row with sane defaults', () => {
      const component = buildComponent();
      component.addSupportingCharacter();
      expect(component.supportingCharactersForm.length).toBe(1);
      const row = component.supportingCharactersForm.at(0);
      expect(row.get('name')?.value).toBe('');
      expect(row.get('role')?.value).toBe('Other');
      expect(row.get('notes')?.value).toBe('');
    });

    it('removeSupportingCharacter drops the right index', () => {
      const component = buildComponent();
      component.addSupportingCharacter();
      component.addSupportingCharacter();
      component.addSupportingCharacter();
      component.supportingCharactersForm.at(0).get('name')?.setValue('A');
      component.supportingCharactersForm.at(1).get('name')?.setValue('B');
      component.supportingCharactersForm.at(2).get('name')?.setValue('C');

      component.removeSupportingCharacter(1);

      expect(component.supportingCharactersForm.length).toBe(2);
      expect(component.supportingCharactersForm.at(0).get('name')?.value).toBe('A');
      expect(component.supportingCharactersForm.at(1).get('name')?.value).toBe('C');
    });

    it('removeSupportingCharacter is a no-op for out-of-range indices', () => {
      const component = buildComponent();
      component.addSupportingCharacter();
      component.removeSupportingCharacter(-1);
      component.removeSupportingCharacter(5);
      expect(component.supportingCharactersForm.length).toBe(1);
    });

    it('supports filling the form with a name + role + notes for one row', () => {
      const component = buildComponent();
      component.addSupportingCharacter();
      const row = component.supportingCharactersForm.at(0);
      row.get('name')?.setValue('Old Hermit');
      row.get('role')?.setValue('Mentor');
      row.get('notes')?.setValue('Knows the way to the hidden temple.');

      const v = row.value as { name: string; role: string; notes: string };
      expect(v.name).toBe('Old Hermit');
      expect(v.role).toBe('Mentor');
      expect(v.notes).toContain('temple');
    });

    it('isCurrentStepValid passes for the characters step with zero supporting', () => {
      const component = buildComponent();
      component.protagonistForm.patchValue({
        name: 'P', role: 'Protagonist', age: 25, background: 'b', motivations: 'm', flaws: 'f', arc: 'a',
      });
      component.antagonistForm.patchValue({
        name: 'V', role: 'Antagonist', age: 35, background: 'b', motivations: 'm', flaws: 'f', arc: 'a',
      });
      component.currentStep = 1;
      expect(component.isCurrentStepValid()).toBe(true);
    });

    it('isCurrentStepValid tolerates empty-name supporting rows', () => {
      const component = buildComponent();
      component.protagonistForm.patchValue({
        name: 'P', role: 'Protagonist', age: 25, background: 'b', motivations: 'm', flaws: 'f', arc: 'a',
      });
      component.antagonistForm.patchValue({
        name: 'V', role: 'Antagonist', age: 35, background: 'b', motivations: 'm', flaws: 'f', arc: 'a',
      });
      // Two empty rows — valid because the user just hit "Add" and
      // hasn't typed anything yet. The submit path drops them.
      component.addSupportingCharacter();
      component.addSupportingCharacter();
      component.currentStep = 1;
      expect(component.isCurrentStepValid()).toBe(true);
    });

    it('hydrates the FormArray from a saved BookConfig on ngOnInit', () => {
      const saved: Partial<BookConfig> = {
        title: 'T',
        genre: 'Fantasy' as any,
        style: 'Literary' as any,
        tone: 'Dark' as any,
        pov: 'First Person' as any,
        tense: 'Past' as any,
        audience: 'Adult' as any,
        themes: ['X'],
        worldType: 'Fantasy' as any,
        targetLength: 'Novel' as any,
        chapterLength: 'Standard' as any,
        protagonist: { name: 'P', role: 'Protagonist', age: 25, background: 'b', motivations: ['m'], flaws: ['f'], arc: 'a' },
        antagonist: { name: 'V', role: 'Antagonist', age: 35, background: 'b', motivations: ['m'], flaws: ['f'], arc: 'a' },
        hasPrologue: false,
        hasEpilogue: false,
        model: 'm',
        supportingCharacters: [
          { name: 'Sage', role: 'Mentor', age: 60, background: 'Wise old wizard', motivations: [], flaws: [], arc: '' },
          { name: 'Rival', role: 'Henchman', age: 30, background: 'Right-hand villain', motivations: [], flaws: [], arc: '' },
        ],
      };
      // buildComponent runs the constructor; ngOnInit is what
      // actually hydrates the FormArray from localStorage. Call it
      // explicitly because TestBed.inject does not run lifecycle
      // hooks on its own.
      const component = buildComponent(JSON.stringify(saved));
      component.ngOnInit();

      expect(component.supportingCharactersForm.length).toBe(2);
      expect(component.supportingCharactersForm.at(0).get('name')?.value).toBe('Sage');
      expect(component.supportingCharactersForm.at(0).get('role')?.value).toBe('Mentor');
      expect(component.supportingCharactersForm.at(0).get('notes')?.value).toBe('Wise old wizard');
      expect(component.supportingCharactersForm.at(1).get('name')?.value).toBe('Rival');
    });
  });

  describe('Supporting character serialization', () => {
    /**
     * Round-trip a populated form through saveConfigToStorage and
     * read the value that was written to localStorage. The full
     * configForm has many required fields; instead of patching them
     * all just to satisfy onSubmit's validity gate, we call the
     * private save method directly via bracket notation — this test
     * is about the supporting-character projection, not validation.
     */
    const captureSavedSupporting = (mutate: (c: ConfigComponent) => void): CharacterProfile[] | undefined => {
      const component = buildComponent(null);
      mutate(component);
      // Bypass the form-validity gate — call the private save path.
      (component as any).saveConfigToStorage(component.configForm.value);
      const written = (localStorage.setItem as jasmine.Spy).calls.mostRecent().args[1] as string;
      const saved = JSON.parse(written) as BookConfig;
      return saved.supportingCharacters;
    };

    it('strips empty-name rows and fills the full CharacterProfile shape', () => {
      const supporting = captureSavedSupporting((component) => {
        component.addSupportingCharacter(); // empty — should be dropped on save
        component.addSupportingCharacter();
        component.supportingCharactersForm.at(1).get('name')?.setValue('Sidekick');
        component.supportingCharactersForm.at(1).get('role')?.setValue('Sidekick');
        component.supportingCharactersForm.at(1).get('notes')?.setValue('Loyal friend');
      });

      expect(Array.isArray(supporting)).toBe(true);
      expect(supporting?.length).toBe(1);
      const only = supporting![0] as CharacterProfile;
      expect(only.name).toBe('Sidekick');
      expect(only.role).toBe('Sidekick');
      // Stripped form fills the unused fields with safe defaults.
      expect(only.background).toBe('Loyal friend');
      expect(only.age).toBe(0);
      expect(only.motivations).toEqual([]);
      expect(only.flaws).toEqual([]);
      expect(only.arc).toBe('');
    });

    it('persists an empty supporting-characters array when no rows are added', () => {
      const supporting = captureSavedSupporting((component) => {
        // No addSupportingCharacter calls — array stays empty.
      });
      expect(supporting).toEqual([]);
    });
  });
});
