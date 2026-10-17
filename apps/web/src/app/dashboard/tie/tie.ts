import { Pipe, type PipeTransform } from '@angular/core';

// Holds a one- or two-letter word to the word after it ("o mașină", "un
// service"): where a button's label needs two lines, no word is left alone.
@Pipe({ name: 'tie' })
export class TiePipe implements PipeTransform {
  transform(text: string): string {
    return text.replace(/(^|\s)(\S{1,2}) (?=\S)/gu, '$1$2 ');
  }
}
