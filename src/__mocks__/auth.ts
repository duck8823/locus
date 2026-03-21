/**
 * Mock Auth.js module for test environment.
 * Returns null session by default (unauthenticated).
 */
export async function auth() {
  return null;
}

export async function signIn() {}
export async function signOut() {}

export const handlers = {
  GET: async () => new Response(),
  POST: async () => new Response(),
};
