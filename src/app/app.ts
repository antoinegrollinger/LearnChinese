import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CharactersService } from './core/characters.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="header">
      <h1><span class="logo">汉字</span> Workshop</h1>
      <nav class="tabs">
        <a class="button" routerLink="/study" routerLinkActive="active">Study</a>
        <a class="button" routerLink="/words" routerLinkActive="active">Words</a>
        <a class="button" routerLink="/review" routerLinkActive="active">Review</a>
        <a class="button" routerLink="/add" routerLinkActive="active">Add</a>
      </nav>
    </header>
    @if (characters.error(); as error) {
      <p class="banner error">
        {{ error }} <button type="button" (click)="characters.reload()">Retry</button>
      </p>
    }
    <main><router-outlet /></main>
  `,
})
export class App {
  protected readonly characters = inject(CharactersService);
}
