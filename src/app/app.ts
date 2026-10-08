import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { CharactersService } from './core/characters.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="header">
      <h1><span class="logo">汉字</span> Workshop</h1>
      @if (auth.user(); as user) {
        <nav class="tabs">
          <a class="button" routerLink="/study" routerLinkActive="active">Study</a>
          <a class="button" routerLink="/words" routerLinkActive="active">Words</a>
          <a class="button" routerLink="/review" routerLinkActive="active">Review</a>
          <a class="button" routerLink="/add" routerLinkActive="active">Add</a>
        </nav>
        <div class="account">
          <span class="muted" title="Logged in">{{ user.email }}</span>
          <button type="button" (click)="auth.logout()">Log out</button>
        </div>
      }
    </header>
    @if (auth.user() && characters.error(); as error) {
      <p class="banner error">
        {{ error }} <button type="button" (click)="characters.reload()">Retry</button>
      </p>
    }
    <main><router-outlet /></main>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly characters = inject(CharactersService);
}
