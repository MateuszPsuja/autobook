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
   * Extract JSON using regex fallback. If the response is truncated
   * (no closing brace) the regex won't match; the caller should
   * recover by grabbing whatever is between the first `{` and the end
   * of the string, and let `fix()` close the missing braces.
   */
  extractWithRegex(content: string): string {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      return match[0];
    }
    // No closing brace found — most likely a truncated response.
    // Return whatever is between the first `{` and end-of-string so
    // the fix() step has something to work with.
    const startIndex = content.indexOf('{');
    if (startIndex !== -1) {
      return content.substring(startIndex);
    }
    throw new Error('Could not extract JSON from response');
  }

  /**
   * Attempt to fix common JSON formatting issues:
   *   - strip control characters
   *   - remove trailing commas
   *   - quote unquoted property names
   *   - strip prose before/after the JSON
   *   - close unclosed braces / brackets
   *
   * The close-unclosed step is the tricky part: it walks the string
   * with a stack (respecting string literals) and closes the
   * delimiters in LIFO order. The previous implementation appended all
   * `]` before all `}` in flat order, which produced invalid JSON for
   * nested structures like `{"x": [{"y":` — it would close the array
   * before the inner object.
   */
  fix(json: string): string {
    let fixed = json;

    fixed = this.sanitize(fixed);
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

    const braceIndex = fixed.indexOf('{');
    if (braceIndex > 0) {
      fixed = fixed.substring(braceIndex);
    }
    const lastBraceIndex = fixed.lastIndexOf('}');
    if (lastBraceIndex < fixed.length - 1 && lastBraceIndex !== -1) {
      fixed = fixed.substring(0, lastBraceIndex + 1);
    }

    // Walk the string with a stack, tracking unclosed delimiters in
    // the order they were opened. Then close in LIFO order.
    const stack: ('{' | '[')[] = [];
    let inString = false;
    let escape = false;
    for (let i = 0; i < fixed.length; i++) {
      const c = fixed[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === '{') stack.push('{');
      else if (c === '[') stack.push('[');
      else if (c === '}') {
        // Pop the matching '{' if present
        const idx = stack.lastIndexOf('{');
        if (idx !== -1) stack.splice(idx, 1);
      } else if (c === ']') {
        const idx = stack.lastIndexOf('[');
        if (idx !== -1) stack.splice(idx, 1);
      }
    }

    // If we ended inside a string literal there's no way to know
    // whether it's closed or not — bail without trying to fix
    // delimiters, since the result would be invalid.
    if (inString) {
      return fixed.trim();
    }

    while (stack.length > 0) {
      const open = stack.pop();
      fixed += open === '{' ? '}' : ']';
    }

    return fixed.trim();
  }

  /**
   * Extract and parse JSON from LLM response with multiple fallback
   * strategies. Every strategy eventually routes through `fix()`, so
   * truncated responses (no closing brace) get a chance to be salvaged
   * by appending `}` / `]` before the parse attempt.
   */
  parse<T = any>(content: string | null | undefined): T {
    if (!content) {
      throw new Error('Response content is empty');
    }

    // Strategy 1: Try to extract from markdown code blocks.
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      const cleaned = codeBlockMatch[1];
      try {
        return JSON.parse(this.sanitize(cleaned));
      } catch (e) {
        try {
          return JSON.parse(this.fix(cleaned));
        } catch (e2) {
          // fall through to brace matching in case the code-block
          // extractor was too greedy
        }
      }
    }

    // Strategy 2: Try proper brace matching.
    let jsonString = '';
    try {
      jsonString = this.extractWithBraceMatching(content);
    } catch (e) {
      // Strategy 3: Fall back to regex (or a partial slice if the
      // response is truncated mid-object).
      try {
        jsonString = this.extractWithRegex(content);
      } catch (e2) {
        throw new Error('Could not extract JSON from response');
      }
    }

    // Try to parse directly.
    const sanitized = this.sanitize(jsonString);
    try {
      return JSON.parse(sanitized);
    } catch (e) {
      // Strategy 4: Try fixing truncated / malformed JSON. `fix()`
      // closes unclosed braces and brackets, which is exactly what
      // we need for truncated responses.
      const fixed = this.fix(sanitized);
      try {
        return JSON.parse(fixed);
      } catch (e2) {
        throw new Error('Could not parse JSON response: ' + (e2 as Error).message);
      }
    }
  }
}
