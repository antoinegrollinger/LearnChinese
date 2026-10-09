import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { CharactersService } from './core/characters.service';
import { NotificationBell } from './shared/notification-bell';
import { ThemeToggle } from './shared/theme-toggle';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NotificationBell, ThemeToggle],
  template: `
    <header class="header">
      <h1><span class="logo">汉字</span> Workshop</h1>
      @if (auth.user(); as user) {
        <nav class="tabs">
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
          <button type="button" (click)="auth.logout()">Log out</button>
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
