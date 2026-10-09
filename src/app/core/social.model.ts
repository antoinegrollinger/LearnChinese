/** Shared by the Angular app and server/social.ts: friends and communities. */
import { ReviewSession } from './review.model';

/** How another user relates to you. */
export type Relation = 'me' | 'friend' | 'incoming' | 'outgoing' | 'none';

/** A friend with the counts every friend can see. */
export interface FriendSummary {
  username: string;
  /** ISO date: when the request was accepted. */
  since: string;
  characters: number;
  words: number;
  /** Number of reviews, or null when they don't share them. */
  reviews: number | null;
}

/** A friend request (incoming: sent to you; outgoing: sent by you). */
export interface FriendRequest {
  username: string;
  /** ISO date */
  at: string;
}

/** GET /api/friends */
export interface FriendsOverview {
  friends: FriendSummary[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

/** GET /api/friends/:username (only for friends): their reviews only when they share them. */
export interface FriendProfile extends FriendSummary {
  sharesReviews: boolean;
  reviews: number | null;
  sessions: ReviewSession[];
}

/** GET/PATCH /api/social/settings */
export interface SocialSettings {
  /** Your friends can see your reviews (off by default). */
  shareReviews: boolean;
}

/** owner: everything (settings, admins); admin: approves join requests and removes members. */
export type CommunityRole = 'owner' | 'admin' | 'member';
/** open: anyone joins at once; approval: an owner or admin approves each join request. */
export type JoinPolicy = 'open' | 'approval';
/** Who sees the member list. */
export type MemberListVisibility = 'members' | 'everyone';

export const JOIN_POLICIES: Record<JoinPolicy, string> = {
  open: 'Anyone can join',
  approval: 'Join requests must be approved by the owner or an admin',
};
export const MEMBER_LIST_VISIBILITY: Record<MemberListVisibility, string> = {
  members: 'Only members see who the members are',
  everyone: 'Everyone sees who the members are',
};
export const ROLE_NAMES: Record<CommunityRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

/** Owners and admins approve join requests and remove members. */
export const canModerate = (role: CommunityRole | null | undefined): boolean =>
  role === 'owner' || role === 'admin';

/** PATCH /api/communities/:name (owner only). */
export interface CommunitySettings {
  description: string;
  joinPolicy: JoinPolicy;
  memberList: MemberListVisibility;
}

export interface CommunitySummary extends CommunitySettings {
  name: string;
  memberCount: number;
  /** How many of your friends are members. */
  friendCount: number;
  joined: boolean;
  /** You asked to join and wait for approval. */
  pending: boolean;
  /** Your role, when you are a member. */
  role: CommunityRole | null;
}

export interface CommunityMember {
  username: string;
  relation: Relation;
  role: CommunityRole;
}

/** A user who asked to join a community. */
export interface JoinRequest {
  username: string;
  /** ISO date */
  at: string;
  relation: Relation;
}

/** GET /api/communities/:name. */
export interface CommunityDetail extends CommunitySummary {
  /** For members, or for everyone when memberList is 'everyone'; otherwise null. */
  members: CommunityMember[] | null;
  /** Pending join requests, for the owner and admins; otherwise null. */
  requests: JoinRequest[] | null;
}

// ---------- Notifications ----------

/** Something that happened (stored in the notifications table). */
export type InfoType =
  | 'friend-accepted'
  | 'join-approved'
  | 'join-rejected'
  | 'made-admin'
  | 'removed-admin'
  | 'removed-from-community'
  | 'made-owner';

/** GET /api/notifications: requests waiting for you (with actions), then what happened. */
export type NotificationItem =
  | { kind: 'friend-request'; username: string; at: string }
  | { kind: 'join-request'; community: string; username: string; at: string }
  | {
      kind: 'info';
      id: number;
      type: InfoType;
      username: string | null;
      community: string | null;
      at: string;
      read: boolean;
    };

export interface NotificationsResponse {
  items: NotificationItem[];
  /** Requests waiting for you + unread updates (the number on the bell). */
  unread: number;
}

export const COMMUNITY_NAME_MAX_LENGTH = 64;
export const COMMUNITY_DESCRIPTION_MAX_LENGTH = 500;

/** Trims and collapses spaces: "  HSK   1 " → "HSK 1". */
export const cleanCommunityName = (name: string): string => name.trim().replace(/\s+/g, ' ');

/** Lower case: names are unique without regard to case ("HSK 1" and "hsk 1" are the same). */
export const communityKey = (name: string): string => cleanCommunityName(name).toLowerCase();

/** 3 to 64 characters, no "/" (names are used in URLs). Returns an error message, or null. */
export function communityNameError(name: string): string | null {
  const value = cleanCommunityName(name);
  if (value.length < 3) return 'Use at least 3 characters.';
  if (value.length > COMMUNITY_NAME_MAX_LENGTH) {
    return `Use at most ${COMMUNITY_NAME_MAX_LENGTH} characters.`;
  }
  if (/[/\\?#%]/.test(value)) return 'Don\'t use "/", "\\", "?", "#" or "%".';
  return null;
}
