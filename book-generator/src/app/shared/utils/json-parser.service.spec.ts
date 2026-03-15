import { JsonParserService } from './json-parser.service';

describe('JsonParserService', () => {
  let service: JsonParserService;

  beforeEach(() => {
    service = new JsonParserService();
  });

  describe('sanitize', () => {
    it('should remove control characters', () => {
      const input = 'Hello\x00World\x07Test';
      const result = service.sanitize(input);
      expect(result).toBe('HelloWorldTest');
    });

    it('should remove null bytes', () => {
      const input = 'Test\x00Value';
      expect(service.sanitize(input)).toBe('TestValue');
    });

    it('should handle string with no control characters', () => {
      const input = 'Normal text with numbers 123';
      expect(service.sanitize(input)).toBe(input);
    });

    it('should remove DEL character', () => {
      const input = 'Before\x7FAfter';
      expect(service.sanitize(input)).toBe('BeforeAfter');
    });
  });

  describe('extractWithBraceMatching', () => {
    it('should extract simple JSON object', () => {
      const input = 'Some text before {"name": "John", "age": 30} some text after';
      const result = service.extractWithBraceMatching(input);
      expect(result).toBe('{"name": "John", "age": 30}');
    });

    it('should extract nested JSON object', () => {
      const input = '{"outer": {"inner": {"deep": "value"}}}';
      const result = service.extractWithBraceMatching(input);
      expect(result).toBe(input);
    });

    it('should handle strings with braces inside quotes', () => {
      const input = '{"text": "This has {braces} inside"}';
      const result = service.extractWithBraceMatching(input);
      expect(result).toBe(input);
    });

    it('should throw error when no opening brace found', () => {
      expect(() => service.extractWithBraceMatching('No braces here')).toThrow();
    });

    it('should throw error when no closing brace found', () => {
      expect(() => service.extractWithBraceMatching('Incomplete { "name":')).toThrow();
    });
  });

  describe('extractWithRegex', () => {
    it('should extract JSON object using regex', () => {
      const input = 'text before {"name": "John"} text after';
      const result = service.extractWithRegex(input);
      expect(result).toBe('{"name": "John"}');
    });

    it('should extract from JSON with nested braces', () => {
      const input = 'Start {"nested": {"value": 123}} End';
      const result = service.extractWithRegex(input);
      expect(result).toBe('{"nested": {"value": 123}}');
    });

    it('should throw error when no JSON found', () => {
      expect(() => service.extractWithRegex('No JSON here')).toThrow();
    });
  });

  describe('fix', () => {
    it('should remove trailing commas', () => {
      const input = '{"name": "John", "age": 30,}';
      const result = service.fix(input);
      expect(result).toBe('{"name": "John", "age": 30}');
    });

    it('should quote unquoted property names', () => {
      const input = '{name: "John", age: 30}';
      const result = service.fix(input);
      expect(result).toContain('"name"');
      expect(result).toContain('"age"');
    });

    it('should handle already valid JSON', () => {
      const input = '{"name": "John"}';
      const result = service.fix(input);
      expect(JSON.parse(result)).toEqual({ name: 'John' });
    });
  });

  describe('parse', () => {
    it('should parse valid JSON', () => {
      const input = '{"name": "John", "age": 30}';
      const result = service.parse<{ name: string; age: number }>(input);
      expect(result.name).toBe('John');
      expect(result.age).toBe(30);
    });

    it('should parse JSON from markdown code block', () => {
      const input = '```json\n{"name": "John"}\n```';
      const result = service.parse<{ name: string }>(input);
      expect(result.name).toBe('John');
    });

    it('should parse JSON from code block without json marker', () => {
      const input = '```\n{"name": "John"}\n```';
      const result = service.parse<{ name: string }>(input);
      expect(result.name).toBe('John');
    });

    it('should throw error for null input', () => {
      expect(() => service.parse(null)).toThrow();
    });

    it('should throw error for undefined input', () => {
      expect(() => service.parse(undefined)).toThrow();
    });

    it('should throw error for empty string', () => {
      expect(() => service.parse('')).toThrow();
    });

    it('should parse complex nested structure', () => {
      const input = JSON.stringify({
        chapters: [
          { title: 'Chapter 1', content: 'Content 1' },
          { title: 'Chapter 2', content: 'Content 2' }
        ],
        metadata: { totalWords: 5000 }
      });
      const result = service.parse(input);
      expect(result.chapters).toHaveSize(2);
      expect(result.metadata.totalWords).toBe(5000);
    });

    it('should handle JSON with newlines', () => {
      const input = '{\n  "name": "John"\n}';
      const result = service.parse<{ name: string }>(input);
      expect(result.name).toBe('John');
    });
  });
});
