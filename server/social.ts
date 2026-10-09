/* Friends, communities and notifications (tables in db/schema.sql). Everything here is on behalf of
 * the logged-in user ("me") and needs a username: others find you by it.
 *
 * - A friend request is pending until the other user accepts it. Friends see each other's number
 *   of characters and words, and their reviews when they share them (app_user.share_reviews).
 * - Anyone can create a community (and becomes its owner) and find one by name. Searching shows
 *   how many members a community has and how many of them are your friends.
 *   - join_policy 'open': anyone joins at once; 'approval': an owner or admin approves requests.
 *   - member_list 'members': only members see the members; 'everyone': anyone does.
 *   - The owner changes the settings and names admins; owners and admins approve or reject join
 *     requests and remove members (an admin only regular members).
 * - Notifications: requests waiting for you (friend requests; join requests of the communities you
 *   moderate) and what happened to you (the notifications table).
 */
import mysql from 'mysql2/promise';
import { User, normalizeUsername } from '../src/app/core/auth.model.ts';
import {
  COMMUNITY_DESCRIPTION_MAX_LENGTH,
  CommunityDetail,
  CommunityRole,
  CommunitySummary,
  FriendProfile,
  FriendsOverview,
  InfoType,
  JOIN_POLICIES,
  JoinPolicy,
  MEMBER_LIST_VISIBILITY,
  MemberListVisibility,
  NotificationItem,
  NotificationsResponse,
  Relation,
  SocialSettings,
  canModerate,
  cleanCommunityName,
  communityKey,
  communityNameError,
} from '../src/app/core/social.model.ts';
import { AuthError } from './auth.ts';
import { ReviewStore } from './store.ts';

type Rows = mysql.RowDataPacket[];
type Result = mysql.ResultSetHeader;
type Db = mysql.Pool | mysql.PoolConnection;

const iso = (value: unknown): string => (value ? new Date(value as string).toISOString() : '');

/** "50%_off" → "50\%\_off", for LIKE. */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => '\\' + c);

/** Counts every friend can see (characters, words; reviews only when shared). */
const FRIEND_COUNTS = `
  (SELECT COUNT(*) FROM characters WHERE user_id = u.id) AS characters,
  (SELECT COUNT(*) FROM words WHERE user_id = u.id) AS words,
  IF(u.share_reviews, (SELECT COUNT(*) FROM review_sessions WHERE user_id = u.id), NULL) AS reviews`;

/** At most this many updates (not requests) in the notification menu. */
const NOTIFICATIONS_SHOWN = 50;

interface Community {
  id: number;
  name: string;
  joinPolicy: JoinPolicy;
  /** My role, or null when I'm not a member. */
  role: CommunityRole | null;
}

/** Runs fn in a transaction (all or nothing). */
async function transaction<R>(pool: mysql.Pool, fn: (db: mysql.PoolConnection) => Promise<R>) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await fn(db);
    await db.commit();
    return result;
  } catch (err) {
    await db.rollback().catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

export function createSocial(pool: mysql.Pool, reviews: ReviewStore) {
  /** Your username, required to use friends and communities. */
  function requireUsername(me: User): string {
    if (!me.username) throw new AuthError(403, 'Choose a username first (Account page).');
    return me.username;
  }

  /** Another account by username (not the "default" user of npm run db:import, which has no email). */
  async function userByName(username: unknown): Promise<{ id: number; username: string }> {
    const name = typeof username === 'string' ? normalizeUsername(username) : '';
    const [[row]] = await pool.query<Rows>(
      `SELECT id, username FROM app_user WHERE username = ? AND email IS NOT NULL`,
      [name],
    );
    if (!row) throw new AuthError(404, `There is no user "${name}".`);
    return { id: Number(row['id']), username: row['username'] };
  }

  async function notify(db: Db, userId: number, type: InfoType, actorId: number, community?: string) {
    await db.query(
      `INSERT INTO notifications (user_id, type, actor_id, community) VALUES (?, ?, ?, ?)`,
      [userId, type, actorId, community ?? null],
    );
  }

  /** The friendship row between two users, in either direction. */
  async function friendshipOf(me: number, other: number) {
    const [[row]] = await pool.query<Rows>(
      `SELECT id, requester_id, status FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
      [me, other, other, me],
    );
    return row;
  }

  /** How each user you have a friendship row with relates to you. */
  async function relations(me: number): Promise<Map<number, Relation>> {
    const [rows] = await pool.query<Rows>(
      `SELECT requester_id, addressee_id, status FROM friendships
       WHERE requester_id = ? OR addressee_id = ?`,
      [me, me],
    );
    const result = new Map<number, Relation>();
    for (const r of rows) {
      const fromMe = Number(r['requester_id']) === me;
      const other = Number(fromMe ? r['addressee_id'] : r['requester_id']);
      result.set(other, r['status'] === 'accepted' ? 'friend' : fromMe ? 'outgoing' : 'incoming');
    }
    return result;
  }

  /** The community, with my role in it. */
  async function communityByName(me: number, name: unknown): Promise<Community> {
    const key = typeof name === 'string' ? communityKey(name) : '';
    const [[row]] = await pool.query<Rows>(
      `SELECT c.id, c.name, c.join_policy,
         (SELECT role FROM community_members WHERE community_id = c.id AND user_id = ?) AS role
       FROM communities c WHERE c.name_key = ?`,
      [me, key],
    );
    if (!row) throw new AuthError(404, 'This community does not exist.');
    return {
      id: Number(row['id']),
      name: row['name'],
      joinPolicy: row['join_policy'] === 'approval' ? 'approval' : 'open',
      role: (row['role'] as CommunityRole) ?? null,
    };
  }

  function requireModerator(community: Community): void {
    if (!canModerate(community.role)) {
      throw new AuthError(403, 'Only the owner and the admins of this community can do that.');
    }
  }

  function requireOwner(community: Community): void {
    if (community.role !== 'owner') {
      throw new AuthError(403, 'Only the owner of this community can do that.');
    }
  }

  /** The role of a user in a community, or null when they're not a member. */
  async function roleOf(db: Db, communityId: number, userId: number): Promise<CommunityRole | null> {
    const [[row]] = await db.query<Rows>(
      `SELECT role FROM community_members WHERE community_id = ? AND user_id = ?`,
      [communityId, userId],
    );
    return (row?.['role'] as CommunityRole) ?? null;
  }

  /** Communities with their counts for you; where: SQL condition on c (with its values). */
  async function communities(me: number, where: string, values: unknown[]): Promise<CommunitySummary[]> {
    const [rows] = await pool.query<Rows>(
      `SELECT c.name, c.description, c.join_policy, c.member_list,
         (SELECT COUNT(*) FROM community_members m WHERE m.community_id = c.id) AS member_count,
         (SELECT COUNT(*) FROM community_members m
            JOIN friendships f ON f.status = 'accepted'
             AND ((f.requester_id = ? AND f.addressee_id = m.user_id)
               OR (f.addressee_id = ? AND f.requester_id = m.user_id))
          WHERE m.community_id = c.id) AS friend_count,
         (SELECT role FROM community_members m WHERE m.community_id = c.id AND m.user_id = ?) AS role,
         EXISTS (SELECT 1 FROM community_join_requests r WHERE r.community_id = c.id AND r.user_id = ?)
           AS pending
       FROM communities c WHERE ${where}
       ORDER BY role IS NULL, member_count DESC, c.name LIMIT 50`,
      [me, me, me, me, ...values],
    );
    return rows.map((r) => ({
      name: r['name'],
      description: r['description'] ?? '',
      joinPolicy: r['join_policy'] === 'approval' ? 'approval' : 'open',
      memberList: r['member_list'] === 'everyone' ? 'everyone' : 'members',
      memberCount: Number(r['member_count']),
      friendCount: Number(r['friend_count']),
      joined: r['role'] != null,
      pending: !!Number(r['pending']),
      role: (r['role'] as CommunityRole) ?? null,
    }));
  }

  /** Makes the user a member (removing their join request), in a transaction. */
  async function addMember(db: Db, communityId: number, userId: number, role: CommunityRole = 'member') {
    await db.query(`DELETE FROM community_join_requests WHERE community_id = ? AND user_id = ?`, [
      communityId,
      userId,
    ]);
    await db.query(
      `INSERT IGNORE INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)`,
      [communityId, userId, role],
    );
  }

  return {
    // ---------- Settings and friends ----------
    async settings(me: User): Promise<SocialSettings> {
      const [[row]] = await pool.query<Rows>(`SELECT share_reviews FROM app_user WHERE id = ?`, [
        me.id,
      ]);
      return { shareReviews: !!Number(row?.['share_reviews']) };
    },

    async setSettings(me: User, body: Record<string, unknown>): Promise<SocialSettings> {
      if (typeof body['shareReviews'] !== 'boolean') {
        throw new AuthError(400, 'shareReviews: true or false.');
      }
      await pool.query(`UPDATE app_user SET share_reviews = ? WHERE id = ?`, [
        body['shareReviews'],
        me.id,
      ]);
      return { shareReviews: body['shareReviews'] };
    },

    async overview(me: User): Promise<FriendsOverview> {
      const [rows] = await pool.query<Rows>(
        `SELECT u.username, f.status, f.requester_id, f.created_at, f.accepted_at, ${FRIEND_COUNTS}
         FROM friendships f
         JOIN app_user u ON u.id = IF(f.requester_id = ?, f.addressee_id, f.requester_id)
         WHERE f.requester_id = ? OR f.addressee_id = ?
         ORDER BY u.username`,
        [me.id, me.id, me.id],
      );
      const overview: FriendsOverview = { friends: [], incoming: [], outgoing: [] };
      for (const r of rows) {
        if (r['status'] === 'accepted') {
          overview.friends.push({
            username: r['username'],
            since: iso(r['accepted_at']),
            characters: Number(r['characters']),
            words: Number(r['words']),
            reviews: r['reviews'] == null ? null : Number(r['reviews']),
          });
        } else {
          const list = Number(r['requester_id']) === me.id ? overview.outgoing : overview.incoming;
          list.push({ username: r['username'], at: iso(r['created_at']) });
        }
      }
      return overview;
    },

    /** Sends a friend request, or accepts theirs if they already sent you one. */
    async request(me: User, username: unknown): Promise<Relation> {
      requireUsername(me);
      const other = await userByName(username);
      if (other.id === me.id) throw new AuthError(400, "That's you!");
      const existing = await friendshipOf(me.id, other.id);
      if (existing?.['status'] === 'accepted') {
        throw new AuthError(409, `You and ${other.username} are already friends.`);
      }
      if (existing && Number(existing['requester_id']) === me.id) {
        throw new AuthError(409, `You already sent ${other.username} a request.`);
      }
      if (existing) return this.accept(me, other.username);
      await pool.query(`INSERT INTO friendships (requester_id, addressee_id) VALUES (?, ?)`, [
        me.id,
        other.id,
      ]);
      return 'outgoing';
    },

    async accept(me: User, username: unknown): Promise<Relation> {
      requireUsername(me);
      const other = await userByName(username);
      await transaction(pool, async (db) => {
        const [result] = await db.query<Result>(
          `UPDATE friendships SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP
           WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
          [other.id, me.id],
        );
        if (!result.affectedRows) throw new AuthError(404, `No request from ${other.username}.`);
        await notify(db, other.id, 'friend-accepted', me.id);
      });
      return 'friend';
    },

    /** Removes a friend, declines their request or cancels yours. */
    async remove(me: User, username: unknown): Promise<void> {
      const other = await userByName(username);
      const [result] = await pool.query<Result>(
        `DELETE FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
        [me.id, other.id, other.id, me.id],
      );
      if (!result.affectedRows) throw new AuthError(404, `${other.username} is not your friend.`);
    },

    /** A friend's counts, and their reviews when they share them. Only for friends. */
    async profile(me: User, username: unknown): Promise<FriendProfile> {
      const other = await userByName(username);
      const [[row]] = await pool.query<Rows>(
        `SELECT u.username, u.share_reviews, f.accepted_at, ${FRIEND_COUNTS}
         FROM friendships f JOIN app_user u ON u.id = ?
         WHERE f.status = 'accepted'
           AND ((f.requester_id = ? AND f.addressee_id = ?) OR (f.requester_id = ? AND f.addressee_id = ?))`,
        [other.id, me.id, other.id, other.id, me.id],
      );
      if (!row) throw new AuthError(404, `${other.username} is not your friend.`);
      const shares = !!Number(row['share_reviews']);
      return {
        username: row['username'],
        since: iso(row['accepted_at']),
        characters: Number(row['characters']),
        words: Number(row['words']),
        reviews: row['reviews'] == null ? null : Number(row['reviews']),
        sharesReviews: shares,
        sessions: shares ? await reviews.all(other.id) : [],
      };
    },

    // ---------- Communities ----------
    /** Communities whose name contains the query, or yours (and those you asked to join) without one. */
    async searchCommunities(me: User, query: string): Promise<CommunitySummary[]> {
      const q = communityKey(query);
      return q
        ? communities(me.id, `c.name_key LIKE ?`, [`%${escapeLike(q)}%`])
        : communities(
            me.id,
            `c.id IN (SELECT community_id FROM community_members WHERE user_id = ?
                      UNION SELECT community_id FROM community_join_requests WHERE user_id = ?)`,
            [me.id, me.id],
          );
    },

    /** Creates a community; you are its owner. */
    async createCommunity(me: User, body: Record<string, unknown>): Promise<CommunityDetail> {
      requireUsername(me);
      const name = typeof body['name'] === 'string' ? cleanCommunityName(body['name']) : '';
      const invalid = communityNameError(name);
      if (invalid) throw new AuthError(400, invalid);
      const description =
        typeof body['description'] === 'string'
          ? body['description'].trim().slice(0, COMMUNITY_DESCRIPTION_MAX_LENGTH)
          : '';
      const joinPolicy: JoinPolicy = body['joinPolicy'] === 'approval' ? 'approval' : 'open';
      try {
        await transaction(pool, async (db) => {
          const [result] = await db.query<Result>(
            `INSERT INTO communities (name, name_key, description, join_policy, created_by)
             VALUES (?, ?, ?, ?, ?)`,
            [name, communityKey(name), description || null, joinPolicy, me.id],
          );
          await addMember(db, result.insertId, me.id, 'owner');
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
          throw new AuthError(409, `There is already a community "${name}": join it instead.`);
        }
        throw err;
      }
      return this.community(me, name);
    },

    async community(me: User, name: unknown): Promise<CommunityDetail> {
      const community = await communityByName(me.id, name);
      const [summary] = await communities(me.id, `c.id = ?`, [community.id]);
      const relationOf = await relations(me.id);
      const relation = (id: number): Relation =>
        id === me.id ? 'me' : (relationOf.get(id) ?? 'none');

      let members: CommunityDetail['members'] = null;
      if (summary.joined || summary.memberList === 'everyone') {
        const [rows] = await pool.query<Rows>(
          `SELECT u.id, u.username, m.role FROM community_members m JOIN app_user u ON u.id = m.user_id
           WHERE m.community_id = ? AND u.username IS NOT NULL
           ORDER BY FIELD(m.role, 'owner', 'admin', 'member'), u.username`,
          [community.id],
        );
        members = rows.map((r) => ({
          username: r['username'],
          relation: relation(Number(r['id'])),
          role: r['role'] as CommunityRole,
        }));
      }

      let requests: CommunityDetail['requests'] = null;
      if (canModerate(summary.role)) {
        const [rows] = await pool.query<Rows>(
          `SELECT u.id, u.username, r.created_at FROM community_join_requests r
           JOIN app_user u ON u.id = r.user_id
           WHERE r.community_id = ? ORDER BY r.created_at`,
          [community.id],
        );
        requests = rows.map((r) => ({
          username: r['username'],
          at: iso(r['created_at']),
          relation: relation(Number(r['id'])),
        }));
      }
      return { ...summary, members, requests };
    },

    /** Joins an open community, or asks to join one that needs approval. */
    async join(me: User, name: unknown): Promise<CommunityDetail> {
      requireUsername(me);
      const community = await communityByName(me.id, name);
      if (!community.role) {
        if (community.joinPolicy === 'open') await addMember(pool, community.id, me.id);
        else {
          await pool.query(
            `INSERT IGNORE INTO community_join_requests (community_id, user_id) VALUES (?, ?)`,
            [community.id, me.id],
          );
        }
      }
      return this.community(me, community.name);
    },

    /** Withdraws your join request. */
    async cancelRequest(me: User, name: unknown): Promise<CommunityDetail> {
      const community = await communityByName(me.id, name);
      await pool.query(`DELETE FROM community_join_requests WHERE community_id = ? AND user_id = ?`, [
        community.id,
        me.id,
      ]);
      return this.community(me, community.name);
    },

    /** Owner or admin: approves or rejects a join request; the user is told. */
    async answerRequest(me: User, name: unknown, username: unknown, approve: boolean) {
      const community = await communityByName(me.id, name);
      requireModerator(community);
      const other = await userByName(username);
      await transaction(pool, async (db) => {
        const [result] = await db.query<Result>(
          `DELETE FROM community_join_requests WHERE community_id = ? AND user_id = ?`,
          [community.id, other.id],
        );
        if (!result.affectedRows) {
          throw new AuthError(404, `${other.username} has no pending request (already answered?).`);
        }
        if (approve) await addMember(db, community.id, other.id);
        await notify(db, other.id, approve ? 'join-approved' : 'join-rejected', me.id, community.name);
      });
      return this.community(me, community.name);
    },

    /** Owner: description, join policy and who sees the members. */
    async updateCommunity(me: User, name: unknown, body: Record<string, unknown>) {
      const community = await communityByName(me.id, name);
      requireOwner(community);
      const changes: string[] = [];
      const values: unknown[] = [];
      if (typeof body['description'] === 'string') {
        changes.push('description = ?');
        values.push(body['description'].trim().slice(0, COMMUNITY_DESCRIPTION_MAX_LENGTH) || null);
      }
      const policy = body['joinPolicy'];
      if (policy !== undefined) {
        if (typeof policy !== 'string' || !(policy in JOIN_POLICIES)) {
          throw new AuthError(400, 'joinPolicy: "open" or "approval".');
        }
        changes.push('join_policy = ?');
        values.push(policy);
      }
      const memberList = body['memberList'];
      if (memberList !== undefined) {
        if (typeof memberList !== 'string' || !(memberList in MEMBER_LIST_VISIBILITY)) {
          throw new AuthError(400, 'memberList: "members" or "everyone".');
        }
        changes.push('member_list = ?');
        values.push(memberList as MemberListVisibility);
      }
      if (!changes.length) throw new AuthError(400, 'Nothing to change.');
      await transaction(pool, async (db) => {
        await db.query(`UPDATE communities SET ${changes.join(', ')} WHERE id = ?`, [
          ...values,
          community.id,
        ]);
        // Now open to all: whoever was waiting gets in.
        if (policy === 'open') {
          const [waiting] = await db.query<Rows>(
            `SELECT user_id FROM community_join_requests WHERE community_id = ?`,
            [community.id],
          );
          for (const w of waiting) {
            await addMember(db, community.id, Number(w['user_id']));
            await notify(db, Number(w['user_id']), 'join-approved', me.id, community.name);
          }
        }
      });
      return this.community(me, community.name);
    },

    /** Owner: makes a member an admin ('admin'), back to a member ('member'), or the owner ('owner', and you become an admin). */
    async setRole(me: User, name: unknown, username: unknown, role: unknown) {
      const community = await communityByName(me.id, name);
      requireOwner(community);
      if (role !== 'admin' && role !== 'member' && role !== 'owner') {
        throw new AuthError(400, 'role: "owner", "admin" or "member".');
      }
      const other = await userByName(username);
      if (other.id === me.id) throw new AuthError(400, 'Make someone else the owner instead.');
      await transaction(pool, async (db) => {
        const current = await roleOf(db, community.id, other.id);
        if (!current) throw new AuthError(404, `${other.username} is not a member.`);
        if (current === role) return;
        await db.query(`UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?`, [
          role,
          community.id,
          other.id,
        ]);
        if (role === 'owner') {
          await db.query(
            `UPDATE community_members SET role = 'admin' WHERE community_id = ? AND user_id = ?`,
            [community.id, me.id],
          );
        }
        const type: InfoType =
          role === 'owner' ? 'made-owner' : role === 'admin' ? 'made-admin' : 'removed-admin';
        await notify(db, other.id, type, me.id, community.name);
      });
      return this.community(me, community.name);
    },

    /** Owner: removes anyone else; admin: removes regular members. They are told. */
    async removeMember(me: User, name: unknown, username: unknown) {
      const community = await communityByName(me.id, name);
      requireModerator(community);
      const other = await userByName(username);
      if (other.id === me.id) throw new AuthError(400, 'To leave the community, use Leave.');
      await transaction(pool, async (db) => {
        const role = await roleOf(db, community.id, other.id);
        if (!role) throw new AuthError(404, `${other.username} is not a member.`);
        if (role === 'owner' || (role === 'admin' && community.role !== 'owner')) {
          throw new AuthError(403, `Only the owner can remove ${other.username}.`);
        }
        await db.query(`DELETE FROM community_members WHERE community_id = ? AND user_id = ?`, [
          community.id,
          other.id,
        ]);
        await notify(db, other.id, 'removed-from-community', me.id, community.name);
      });
      return this.community(me, community.name);
    },

    /**
     * Leaves the community. When the owner leaves, the first admin (or else the longest-standing
     * member) becomes the owner; the community is deleted when its last member leaves.
     */
    async leave(me: User, name: unknown): Promise<void> {
      const community = await communityByName(me.id, name);
      await transaction(pool, async (db) => {
        await db.query(`DELETE FROM community_members WHERE community_id = ? AND user_id = ?`, [
          community.id,
          me.id,
        ]);
        if (community.role === 'owner') {
          const [[next]] = await db.query<Rows>(
            `SELECT user_id FROM community_members WHERE community_id = ?
             ORDER BY role = 'admin' DESC, joined_at, user_id LIMIT 1`,
            [community.id],
          );
          if (next) {
            await db.query(
              `UPDATE community_members SET role = 'owner' WHERE community_id = ? AND user_id = ?`,
              [community.id, next['user_id']],
            );
            await notify(db, Number(next['user_id']), 'made-owner', me.id, community.name);
          }
        }
        await db.query(
          `DELETE FROM communities WHERE id = ?
             AND NOT EXISTS (SELECT 1 FROM community_members WHERE community_id = ?)`,
          [community.id, community.id],
        );
      });
    },

    // ---------- Notifications ----------
    /** Requests waiting for you (newest first), then the latest updates. */
    async notifications(me: User): Promise<NotificationsResponse> {
      const [friendRequests] = await pool.query<Rows>(
        `SELECT u.username, f.created_at FROM friendships f JOIN app_user u ON u.id = f.requester_id
         WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`,
        [me.id],
      );
      const [joinRequests] = await pool.query<Rows>(
        `SELECT c.name AS community, u.username, r.created_at FROM community_join_requests r
         JOIN communities c ON c.id = r.community_id
         JOIN community_members m ON m.community_id = r.community_id AND m.user_id = ?
           AND m.role IN ('owner', 'admin')
         JOIN app_user u ON u.id = r.user_id
         ORDER BY r.created_at DESC`,
        [me.id],
      );
      const [updates] = await pool.query<Rows>(
        `SELECT n.id, n.type, u.username, n.community, n.created_at, n.read_at
         FROM notifications n LEFT JOIN app_user u ON u.id = n.actor_id
         WHERE n.user_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT ${NOTIFICATIONS_SHOWN}`,
        [me.id],
      );
      const requests: NotificationItem[] = [
        ...friendRequests.map(
          (r): NotificationItem => ({
            kind: 'friend-request',
            username: r['username'],
            at: iso(r['created_at']),
          }),
        ),
        ...joinRequests.map(
          (r): NotificationItem => ({
            kind: 'join-request',
            community: r['community'],
            username: r['username'],
            at: iso(r['created_at']),
          }),
        ),
      ].sort((a, b) => b.at.localeCompare(a.at));
      const infos = updates.map(
        (r): NotificationItem => ({
          kind: 'info',
          id: Number(r['id']),
          type: r['type'] as InfoType,
          username: r['username'] ?? null,
          community: r['community'] ?? null,
          at: iso(r['created_at']),
          read: r['read_at'] != null,
        }),
      );
      const unreadInfos = infos.filter((n) => n.kind === 'info' && !n.read).length;
      return { items: [...requests, ...infos], unread: requests.length + unreadInfos };
    },

    async markNotificationsRead(me: User): Promise<void> {
      await pool.query(
        `UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL`,
        [me.id],
      );
    },

    async dismissNotification(me: User, id: number): Promise<void> {
      await pool.query(`DELETE FROM notifications WHERE user_id = ? AND id = ?`, [me.id, id]);
    },

    /** Updates older than 90 days (with the session cleanup, every hour). */
    async cleanup(): Promise<void> {
      await pool.query(
        `DELETE FROM notifications WHERE created_at < CURRENT_TIMESTAMP - INTERVAL 90 DAY`,
      );
    },
  };
}

export type Social = ReturnType<typeof createSocial>;
