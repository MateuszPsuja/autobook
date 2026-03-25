import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class JsonParserService {
  /**
   * Sanitize JSON string by removing invalid control characters
   */
  sanitize(jsonString: string): string {
    return jsonString.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Extract balanced JSON object from string using brace matching
   */
  extractWithBraceMatching(content: string): string {
    const startIndex = content.indexOf('{');
    if (startIndex === -1) {
      throw new Error('Could not extract JSON from response: no opening brace found');
    }

    let depth = 0;
    let inString = false;
    let escape = false;
    let endIndex = -1;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (endIndex === -1) {
      throw new Error('Could not extract JSON from response: no closing brace found');
    }

    return content.substring(startIndex, endIndex + 1);
  }

  /**
   * Extract JSON using regex fallback
   */
  extractWithRegex(content: string): string {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      return match[0];
    }
    throw new Error('Could not extract JSON from response');
  }

  /**
   * Attempt to fix common JSON formatting issues
   */
  fix(json: string): string {
    let fixed = json;

    // Remove control characters
    fixed = this.sanitize(fixed);

    // Remove trailing commas before } or ]
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

    // Fix unquoted property names (simple cases)
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

    // Remove any text before the opening brace
    const braceIndex = fixed.indexOf('{');
    if (braceIndex > 0) {
      fixed = fixed.substring(braceIndex);
    }

    // Remove any text after the closing brace
    const lastBraceIndex = fixed.lastIndexOf('}');
    if (lastBraceIndex < fixed.length - 1) {
      fixed = fixed.substring(0, lastBraceIndex + 1);
    }

    // Complete unclosed arrays and objects
    let openBraces = (fixed.match(/\{/g) || []).length;
    let closeBraces = (fixed.match(/\}/g) || []).length;
    let openBrackets = (fixed.match(/\[/g) || []).length;
    let closeBrackets = (fixed.match(/\]/g) || []).length;

    while (closeBrackets < openBrackets) {
      fixed += ']';
      closeBrackets++;
    }
    while (closeBraces < openBraces) {
      fixed += '}';
      closeBraces++;
    }

    return fixed.trim();
  }

  /**
   * Extract and parse JSON from LLM response with multiple fallback strategies
   */
  parse<T = any>(content: string | null | undefined): T {
    // Handle null/undefined content
    if (!content) {
      throw new Error('Response content is empty');
    }

    // Strategy 1: Try to extract from markdown code blocks
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      const sanitized = this.sanitize(codeBlockMatch[1]);
      try {
        return JSON.parse(sanitized);
      } catch (e) {
        const fixed = this.fix(sanitized);
        return JSON.parse(fixed);
      }
    }

    // Strategy 2: Try proper brace matching
    let jsonString: string;
    try {
      jsonString = this.extractWithBraceMatching(content);
    } catch (e) {
      // Strategy 3: Fall back to regex
      try {
        jsonString = this.extractWithRegex(content);
      } catch (e2) {
        throw new Error('Could not extract JSON from response');
      }
    }

    // Sanitize and parse
    const sanitized = this.sanitize(jsonString);

    try {
      return JSON.parse(sanitized);
    } catch (e) {
      // Strategy 4: Try fixing truncated JSON
      const fixed = this.fix(sanitized);
      try {
        return JSON.parse(fixed);
      } catch (e2) {
        throw new Error('Could not parse JSON response: ' + (e2 as Error).message);
      }
    }
  }
}
