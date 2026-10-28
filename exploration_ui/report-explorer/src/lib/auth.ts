/**
 * NextAuth configuration with IBM App ID
 */

import NextAuth, { NextAuthConfig } from "next-auth";
import { JWT } from "next-auth/jwt";

const config: NextAuthConfig = {
  trustHost: true,
  basePath: "/api/auth",
  useSecureCookies: process.env.NODE_ENV === "production",
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production"
        ? `__Secure-next-auth.session-token`
        : `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    {
      id: "appid",
      name: "IBM App ID",
      type: "oidc",
      issuer: `${process.env.APPID_OAUTH_SERVER_URL}`,
      authorization: {
        params: {
          scope: "openid profile email",
        },
      },
      clientId: process.env.APPID_CLIENT_ID,
      clientSecret: process.env.APPID_SECRET,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name || profile.email,
          email: profile.email,
          image: profile.picture,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // Persist the OAuth access_token and id_token to the token right after signin
      if (account) {
        token.accessToken = account.access_token;
        token.idToken = account.id_token;
        token.expiresAt = account.expires_at;
      }
      
      // Add user info from profile
      if (profile) {
        token.email = profile.email;
        token.name = profile.name;
      }
      
      return token;
    },
    async session({ session, token }) {
      // Send properties to the client
      session.accessToken = token.accessToken as string;
      session.idToken = token.idToken as string;
      session.user.id = token.sub as string;
      
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);

/**
 * Middleware helper to check if user is authenticated
 */
export async function requireAuth() {
  const session = await auth();
  
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  
  return session;
}

