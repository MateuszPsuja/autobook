import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'wordCount'
})
export class WordCountPipe implements PipeTransform {
  transform(text: string): number {
    if (!text || typeof text !== 'string') {
      return 0;
    }
    
    // Remove extra whitespace and split by spaces
    const words = text.trim().split(/\s+/);
    return words.length;
  }
}