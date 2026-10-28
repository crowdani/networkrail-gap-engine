/**
 * API Route Authentication Helper
 * Use this to protect API routes
 */

import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { Session } from "next-auth";

/**
 * Wrapper for API routes that require authentication
 * Usage:
 * export const GET = withAuth(async (req, session) => {
 *   // Your API logic here
 *   // session.user is available
 * });
 */
export function withAuth(
  handler: (
    req: NextRequest,
    session: Session
  ) => Promise<NextResponse>
) {
  return async (req: NextRequest) => {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return handler(req, session);
  };
}


