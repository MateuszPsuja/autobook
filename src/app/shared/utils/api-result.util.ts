import { TokenUsage } from '../../core/api.service';

/**
 * Standard result wrapper for API calls with usage tracking
 */
export interface ApiResult<T> {
  data: T;
  usage: TokenUsage;
}

/**
 * Extract usage from API response
 */
export function extractUsage(response: any): TokenUsage {
  return {
    promptTokens: response.usage?.prompt_tokens || 0,
    completionTokens: response.usage?.completion_tokens || 0,
    totalTokens: response.usage?.total_tokens || 0
  };
}

/**
 * Count words in text (shared utility)
 */
export function countWords(text: string | null | undefined): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Create default usage object for error cases
 */
export function defaultUsage(): TokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  };
}
