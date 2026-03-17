import type { Adapter, AdapterUser, AdapterAccount, AdapterSession, VerificationToken } from "next-auth/adapters";
import type { Sql } from "@/server/infrastructure/db/postgres/types";

/**
 * Auth.js adapter backed by postgresjs (`postgres` package).
 * Maps between Auth.js camelCase models and our snake_case DB columns.
 */
export function PostgresJsAdapter(sql: Sql): Adapter {
  return {
    async createUser(user) {
      const rows = await sql<DbUser[]>`
        INSERT INTO auth_users (name, email, email_verified, image)
        VALUES (${user.name ?? null}, ${user.email}, ${user.emailVerified?.toISOString() ?? null}, ${user.image ?? null})
        RETURNING *
      `;
      return toAdapterUser(rows[0]);
    },

    async getUser(id) {
      const rows = await sql<DbUser[]>`
        SELECT * FROM auth_users WHERE id = ${id}
      `;
      return rows.length > 0 ? toAdapterUser(rows[0]) : null;
    },

    async getUserByEmail(email) {
      const rows = await sql<DbUser[]>`
        SELECT * FROM auth_users WHERE email = ${email}
      `;
      return rows.length > 0 ? toAdapterUser(rows[0]) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const rows = await sql<DbUser[]>`
        SELECT u.* FROM auth_users u
        JOIN auth_accounts a ON u.id = a.user_id
        WHERE a.provider = ${provider}
          AND a.provider_account_id = ${providerAccountId}
      `;
      return rows.length > 0 ? toAdapterUser(rows[0]) : null;
    },

    async updateUser(user) {
      const rows = await sql<DbUser[]>`
        UPDATE auth_users SET
          name = COALESCE(${user.name ?? null}, name),
          email = COALESCE(${user.email ?? null}, email),
          email_verified = COALESCE(${user.emailVerified?.toISOString() ?? null}, email_verified),
          image = COALESCE(${user.image ?? null}, image)
        WHERE id = ${user.id}
        RETURNING *
      `;
      return toAdapterUser(rows[0]);
    },

    async deleteUser(userId) {
      await sql`DELETE FROM auth_users WHERE id = ${userId}`;
    },

    async linkAccount(account) {
      const refreshToken = (account.refresh_token as string | undefined) ?? null;
      const accessToken = (account.access_token as string | undefined) ?? null;
      const expiresAt = (account.expires_at as number | undefined) ?? null;
      const tokenType = (account.token_type as string | undefined) ?? null;
      const scope = (account.scope as string | undefined) ?? null;
      const idToken = (account.id_token as string | undefined) ?? null;
      const sessionState = (account.session_state as string | undefined) ?? null;

      await sql`
        INSERT INTO auth_accounts (
          user_id, type, provider, provider_account_id,
          refresh_token, access_token, expires_at, token_type,
          scope, id_token, session_state
        ) VALUES (
          ${account.userId}, ${account.type}, ${account.provider}, ${account.providerAccountId},
          ${refreshToken}, ${accessToken},
          ${expiresAt}, ${tokenType},
          ${scope}, ${idToken}, ${sessionState}
        )
      `;
    },

    async unlinkAccount({ provider, providerAccountId }) {
      await sql`
        DELETE FROM auth_accounts
        WHERE provider = ${provider} AND provider_account_id = ${providerAccountId}
      `;
    },

    async createSession(session) {
      const rows = await sql<DbSession[]>`
        INSERT INTO auth_sessions (user_id, session_token, expires)
        VALUES (${session.userId}, ${session.sessionToken}, ${session.expires.toISOString()})
        RETURNING *
      `;
      return toAdapterSession(rows[0]);
    },

    async getSessionAndUser(sessionToken) {
      const rows = await sql<(DbSession & DbUser)[]>`
        SELECT s.*, u.id as user_id_from_user, u.name, u.email, u.email_verified, u.image
        FROM auth_sessions s
        JOIN auth_users u ON s.user_id = u.id
        WHERE s.session_token = ${sessionToken}
          AND s.expires > NOW()
      `;
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        session: toAdapterSession(row),
        user: {
          id: row.user_id,
          name: row.name ?? null,
          email: row.email,
          emailVerified: row.email_verified ? new Date(row.email_verified) : null,
          image: row.image ?? null,
        },
      };
    },

    async updateSession(session) {
      const rows = await sql<DbSession[]>`
        UPDATE auth_sessions SET
          expires = COALESCE(${session.expires?.toISOString() ?? null}, expires),
          user_id = COALESCE(${(session as AdapterSession).userId ?? null}, user_id)
        WHERE session_token = ${session.sessionToken}
        RETURNING *
      `;
      return rows.length > 0 ? toAdapterSession(rows[0]) : null;
    },

    async deleteSession(sessionToken) {
      await sql`DELETE FROM auth_sessions WHERE session_token = ${sessionToken}`;
    },

    async createVerificationToken(token) {
      const rows = await sql<DbVerificationToken[]>`
        INSERT INTO auth_verification_tokens (identifier, token, expires)
        VALUES (${token.identifier}, ${token.token}, ${token.expires.toISOString()})
        RETURNING *
      `;
      return toVerificationToken(rows[0]);
    },

    async useVerificationToken({ identifier, token }) {
      const rows = await sql<DbVerificationToken[]>`
        DELETE FROM auth_verification_tokens
        WHERE identifier = ${identifier} AND token = ${token}
        RETURNING *
      `;
      return rows.length > 0 ? toVerificationToken(rows[0]) : null;
    },
  };
}

// --- DB row types ---

interface DbUser {
  id: string;
  name: string | null;
  email: string;
  email_verified: string | null;
  image: string | null;
}

interface DbSession {
  id: string;
  user_id: string;
  session_token: string;
  expires: string;
}

interface DbVerificationToken {
  identifier: string;
  token: string;
  expires: string;
}

// --- Mappers ---

function toAdapterUser(row: DbUser): AdapterUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.email_verified ? new Date(row.email_verified) : null,
    image: row.image,
  };
}

function toAdapterSession(row: DbSession): AdapterSession {
  return {
    sessionToken: row.session_token,
    userId: row.user_id,
    expires: new Date(row.expires),
  };
}

function toVerificationToken(row: DbVerificationToken): VerificationToken {
  return {
    identifier: row.identifier,
    token: row.token,
    expires: new Date(row.expires),
  };
}
