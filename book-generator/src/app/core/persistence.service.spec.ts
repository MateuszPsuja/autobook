import { TestBed } from '@angular/core/testing';
import { PersistenceService, BookMeta } from './persistence.service';

describe('PersistenceService', () => {
  let service: PersistenceService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [PersistenceService]
    });
    service = TestBed.inject(PersistenceService);
  });

  describe('Service Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });
  });

  describe('saveCheckpoint', () => {
    it('should exist saveCheckpoint method', () => {
      expect(service.saveCheckpoint).toBeDefined();
      expect(typeof service.saveCheckpoint).toBe('function');
    });
  });

  describe('loadCheckpoint', () => {
    it('should exist loadCheckpoint method', () => {
      expect(service.loadCheckpoint).toBeDefined();
      expect(typeof service.loadCheckpoint).toBe('function');
    });
  });

  describe('listBooks', () => {
    it('should exist listBooks method', () => {
      expect(service.listBooks).toBeDefined();
      expect(typeof service.listBooks).toBe('function');
    });
  });

  describe('saveBookMeta', () => {
    it('should exist saveBookMeta method', () => {
      expect(service.saveBookMeta).toBeDefined();
      expect(typeof service.saveBookMeta).toBe('function');
    });
  });

  describe('deleteBook', () => {
    it('should exist deleteBook method', () => {
      expect(service.deleteBook).toBeDefined();
      expect(typeof service.deleteBook).toBe('function');
    });
  });

  describe('clearAll', () => {
    it('should exist clearAll method', () => {
      expect(service.clearAll).toBeDefined();
      expect(typeof service.clearAll).toBe('function');
    });
  });
});
