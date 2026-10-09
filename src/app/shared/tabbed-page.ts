import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { CharactersService } from '../core/characters.service';
import { ReviewsService } from '../core/reviews.service';
import { WordsService } from '../core/words.service';

export type TabCount = 'characters' | 'words' | 'character-reviews' | 'word-reviews';

/** One tab of a page (route data "tabs"). */
export interface PageTab {
  name: string;
  /** Chinese character before the name: 字, 词 */
  icon: string;
  /**
   * Where the tab opens; URLs starting with it belong to it (the longest one wins). May use the
   * page's route parameters: "/friends/:username/words".
   */
  path: string;
  /** Show the number of your characters or words, or of your reviews of them. */
  count?: TabCount;
}

/**
 * A page with tabs (Study, Add): the tabs come from the route's data, the tab's page from its
 * child routes. Switching back to a tab opens it where you left it.
 */
@Component({
  selector: 'app-tabbed-page',
  imports: [RouterOutlet, RouterLink],
  template: `
    <nav class="page-tabs" [attr.aria-label]="label">
      @for (tab of tabs(); track tab.path) {
        <a
          [routerLink]="lastUrl()[tab.path]"
          [class.active]="active() === tab.path"
          [attr.aria-current]="active() === tab.path ? 'page' : null"
        >
          <span lang="zh" aria-hidden="true">{{ tab.icon }}</span> {{ tab.name }}
          @if (tab.count) {
            <span class="tab-count">{{ countOf(tab.count) }}</span>
          }
        </a>
      }
    </nav>
    <router-outlet />
  `,
})
export class TabbedPage {
  private readonly router = inject(Router);
  private readonly characters = inject(CharactersService);
  private readonly words = inject(WordsService);
  private readonly reviews = inject(ReviewsService);

  private readonly route = inject(ActivatedRoute);
  private readonly templates: PageTab[] = this.route.snapshot.data['tabs'] ?? [];
  protected readonly label: string = this.route.snapshot.data['label'] ?? '';
  /** The page's route parameters (they change when the page is reused, e.g. another friend). */
  private readonly params = toSignal(this.route.params, {
    initialValue: this.route.snapshot.params,
  });

  /** The tabs, with the route parameters in their paths. */
  protected readonly tabs = computed(() =>
    this.templates.map((t) => ({
      ...t,
      path: t.path.replace(/:(\w+)/g, (_, name: string) => this.params()[name] ?? ''),
    })),
  );

  /** Where each tab was left (by tab path), so switching back opens the same character or word. */
  private readonly last: Record<string, string> = {};

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => this.remember(e.urlAfterRedirects)),
    ),
    { initialValue: this.remember(this.router.url) },
  );

  /** The path of the tab shown. */
  protected readonly active = computed(() => this.tabOf(pathOf(this.url()))?.path);
  protected readonly lastUrl = computed(() => {
    this.url();
    return Object.fromEntries(this.tabs().map((t) => [t.path, this.last[t.path] ?? t.path]));
  });

  protected countOf(count: TabCount): number {
    if (count === 'characters') return this.characters.list().length;
    if (count === 'words') return this.words.list().length;
    const kind = count === 'word-reviews' ? 'words' : 'characters';
    return this.reviews.list().filter((s) => s.kind === kind).length;
  }

  /** The tab whose path is the longest start of this one. */
  private tabOf(path: string): PageTab | undefined {
    return this.tabs()
      .filter((t) => path === t.path || path.startsWith(t.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0];
  }

  /** Notes the URL as where its tab was left. */
  private remember(url: string): string {
    const path = pathOf(url);
    const tab = this.tabOf(path);
    if (tab) this.last[tab.path] = path;
    return url;
  }
}

/** The path, decoded: routerLink encodes it again ("/study/妈", not "/study/%E5%A6%88"). */
function pathOf(url: string): string {
  return url
    .split(/[?#]/)[0]
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}
