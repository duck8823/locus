import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt({ token, account, profile }) {
      if (account && profile) {
        token.githubId = profile.id as unknown as number;
        token.githubLogin = profile.login as unknown as string;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        (session.user as AuthUser).githubId = token.githubId as number;
        (session.user as AuthUser).githubLogin = token.githubLogin as string;
      }
      return session;
    },
  },
});

interface AuthUser {
  githubId: number;
  githubLogin: string;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      githubId: number;
      githubLogin: string;
    };
  }
}
