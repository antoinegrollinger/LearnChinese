import { Component, computed, input } from '@angular/core';
import { pinyinSegments } from '../../core/pinyin';

/** Pinyin coloured by tone: <app-pinyin text="ni3 hao3" /> */
@Component({
  selector: 'app-pinyin',
  templateUrl: './pinyin.html',
})
export class Pinyin {
  readonly text = input<string | undefined>('');
  protected readonly segments = computed(() => pinyinSegments(this.text()));
}
