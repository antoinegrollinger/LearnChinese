import { Component, computed, effect, inject, input, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/characters.service';
import {
  COMMUNITY_DESCRIPTION_MAX_LENGTH,
  CommunityDetail,
  CommunityMember,
  CommunityRole,
  JOIN_POLICIES,
  JoinPolicy,
  MEMBER_LIST_VISIBILITY,
  MemberListVisibility,
  ROLE_NAMES,
  canModerate,
} from '../../core/social.model';
import { MessagePipe, PluralPipe, TranslatePipe, locale, t } from '../../core/i18n';
import { SocialService, isNotFound } from '../../core/social.service';

const DATE_FORMAT = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });

/**
 * One community (/communities/:name): join or ask to join, its members (add them as friends),
 * and for the owner and admins: join requests, settings and roles.
 */
@Component({
  selector: 'app-community',
  imports: [RouterLink, TranslatePipe, PluralPipe, MessagePipe],
  templateUrl: './community.html',
})
export class CommunityPage {
  /** Route parameter */
  readonly name = input.required<string>();

  protected readonly auth = inject(AuthService);
  private readonly social = inject(SocialService);
  private readonly router = inject(Router);

  protected readonly community = resource({
    params: () => this.name(),
    loader: ({ params: name }) => this.social.community(name),
  });
  protected readonly isNotFound = isNotFound;
  protected readonly errorMessage = errorMessage;
  protected readonly roleNames = ROLE_NAMES;
  protected readonly joinPolicies = Object.entries(JOIN_POLICIES) as [JoinPolicy, string][];
  protected readonly memberLists = Object.entries(MEMBER_LIST_VISIBILITY) as [
    MemberListVisibility,
    string,
  ][];
  protected readonly descriptionMax = COMMUNITY_DESCRIPTION_MAX_LENGTH;
  protected readonly busy = signal(false);
  protected readonly status = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });

  /** Owner: the settings form (filled from the community when it loads). */
  protected readonly settingsOpen = signal(false);
  protected readonly draft = signal({
    description: '',
    joinPolicy: 'open' as JoinPolicy,
    memberList: 'members' as MemberListVisibility,
  });

  protected readonly role = computed(() => this.community.value()?.role ?? null);
  protected readonly isOwner = computed(() => this.role() === 'owner');
  protected readonly moderates = computed(() => canModerate(this.role()));

  constructor() {
    // Something changed elsewhere (e.g. a request answered from the notification menu): reload.
    let first = true;
    effect(() => {
      this.social.changes();
      if (first) first = false;
      else this.community.reload();
    });
  }

  protected date(iso: string): string {
    return DATE_FORMAT.format(new Date(iso));
  }

  /** Runs an action that returns the updated community, then shows a message. */
  private async run(
    action: () => Promise<CommunityDetail | void>,
    done: string | ((c?: CommunityDetail) => string),
  ): Promise<void> {
    this.busy.set(true);
    try {
      const detail = await action();
      if (detail) this.community.set(detail);
      this.status.set({
        text: typeof done === 'string' ? done : done(detail ?? undefined),
        kind: 'ok',
      });
    } catch (err) {
      this.status.set({ text: errorMessage(err), kind: 'error' });
    } finally {
      this.busy.set(false);
    }
  }

  // ---------- Membership ----------
  protected join(): void {
    this.run(
      () => this.social.join(this.name()),
      (c) =>
        c?.joined
          ? t('Welcome! You can now see the members.')
          : t('Request sent: an owner or admin will answer it.'),
    );
  }

  protected cancelRequest(): void {
    this.run(() => this.social.cancelJoinRequest(this.name()), t('Request withdrawn.'));
  }

  protected leave(): void {
    const c = this.community.value();
    const note =
      c?.memberCount === 1
        ? ' ' + t('You are its last member: it will be deleted.')
        : c?.role === 'owner'
          ? ' ' + t('An admin (or else the longest-standing member) will become the owner.')
          : '';
    if (!confirm(t('Leave {community}?', { community: c?.name ?? this.name() }) + note)) return;
    this.run(async () => {
      await this.social.leave(this.name());
      this.router.navigate(['/communities']);
    }, '');
  }

  // ---------- Friends ----------
  /** Sends a friend request (or accepts theirs), then shows the new relation. */
  protected addFriend(member: { username: string }): void {
    this.run(
      async () => {
        await this.social.addFriend(member.username);
        return this.social.community(this.name());
      },
      (c) => {
        const relation = c?.members?.find((m) => m.username === member.username)?.relation;
        return relation === 'friend'
          ? t('You and {name} are now friends ✓', { name: member.username })
          : t('Request sent to {name} ✓', { name: member.username });
      },
    );
  }

  // ---------- Owner and admins ----------
  protected answer(username: string, approve: boolean): void {
    this.run(
      () => this.social.answerJoinRequest(this.name(), username, approve),
      approve
        ? t('{name} is now a member ✓', { name: username })
        : t("Rejected {name}'s request.", { name: username }),
    );
  }

  /** Whether you can remove this member: the owner removes anyone else, an admin regular members. */
  protected canRemove(member: CommunityMember): boolean {
    if (member.relation === 'me' || member.role === 'owner') return false;
    return this.isOwner() || (this.role() === 'admin' && member.role === 'member');
  }

  protected removeMember(member: CommunityMember): void {
    const community = this.community.value()?.name ?? this.name();
    if (!confirm(t('Remove {name} from {community}?', { name: member.username, community }))) {
      return;
    }
    this.run(
      () => this.social.removeMember(this.name(), member.username),
      t('{name} was removed.', { name: member.username }),
    );
  }

  protected setRole(member: CommunityMember, role: CommunityRole): void {
    if (
      role === 'owner' &&
      !confirm(
        t('Make {name} the owner of {community}? You will become an admin.', {
          name: member.username,
          community: this.community.value()?.name ?? this.name(),
        }),
      )
    ) {
      return;
    }
    const text =
      role === 'owner'
        ? t('{name} is now the owner; you are an admin.', { name: member.username })
        : role === 'admin'
          ? t('{name} is now an admin ✓', { name: member.username })
          : t('{name} is now a regular member.', { name: member.username });
    this.run(() => this.social.setRole(this.name(), member.username, role), text);
  }

  protected openSettings(): void {
    const c = this.community.value();
    if (!c) return;
    this.draft.set({
      description: c.description,
      joinPolicy: c.joinPolicy,
      memberList: c.memberList,
    });
    this.settingsOpen.set(true);
  }

  protected updateDraft(change: Partial<ReturnType<typeof this.draft>>): void {
    this.draft.update((d) => ({ ...d, ...change }));
  }

  protected saveSettings(): void {
    const opening =
      this.draft().joinPolicy === 'open' &&
      this.community.value()?.joinPolicy === 'approval' &&
      (this.community.value()?.requests?.length ?? 0) > 0;
    if (
      opening &&
      !confirm(
        t('Anyone can now join: the people waiting for an answer will join at once. Continue?'),
      )
    ) {
      return;
    }
    this.run(async () => {
      const detail = await this.social.updateCommunity(this.name(), this.draft());
      this.settingsOpen.set(false);
      return detail;
    }, t('Settings saved ✓'));
  }
}
