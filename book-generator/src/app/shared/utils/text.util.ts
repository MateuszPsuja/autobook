import { Injectable } from '@angular/core';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PromptBuilderService {
  /**
   * Build messages array for a typical agent request
   */
  buildMessages(systemPrompt: string, userPrompt: string): ChatMessage[] {
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
  }

  /**
   * Build a request object with common defaults
   */
  buildRequest(model: string, messages: ChatMessage[], options?: {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
  }): ChatCompletionRequest {
    return {
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
      stream: options?.stream ?? false
    };
  }
}
