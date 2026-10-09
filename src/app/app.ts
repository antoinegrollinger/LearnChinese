import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { CharactersService } from './core/characters.service';
import { NotificationBell } from './shared/notification-bell';
import { SlidingThumb } from './shared/sliding-thumb';
import { ThemeToggle } from './shared/theme-toggle';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NotificationBell,
    SlidingThumb,
    ThemeToggle,
  ],
  template: `
    <header class="header">
      <h1><span class="logo">汉字</span> Workshop</h1>
      @if (auth.user(); as user) {
        <nav class="tabs" appSlidingThumb>
          <a class="button" routerLink="/study" routerLinkActive="active">Study</a>
          <a class="button" routerLink="/review" routerLinkActive="active">Review</a>
          <a class="button" routerLink="/dashboard" routerLinkActive="active">Dashboard</a>
          <a class="button" routerLink="/add" routerLinkActive="active">Add</a>
          <a class="button" routerLink="/friends" routerLinkActive="active">Friends</a>
          <a class="button" routerLink="/communities" routerLinkActive="active">Communities</a>
        </nav>
        <div class="account">
          <app-theme-toggle />
          <app-notification-bell />
          <a routerLink="/account" routerLinkActive="active" [title]="user.email">{{
            user.username ?? user.email
          }}</a>
          <button
            type="button"
            class="logout"
            title="Log out"
            aria-label="Log out"
            (click)="auth.logout()"
          >
            <!-- Icon on phones, text on wider screens (styles.css) -->
            <svg class="logout-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <g
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
                <path d="M10 16l-4-4 4-4M6 12h10" />
              </g>
            </svg>
            <span class="logout-text">Log out</span>
          </button>
        </div>
      } @else {
        <div class="account"><app-theme-toggle /></div>
      }
    </header>
    @if (auth.user(); as user) {
      @if (!user.username) {
        <p class="banner">Choose a username: <a routerLink="/account">Account →</a></p>
      }
    }
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
