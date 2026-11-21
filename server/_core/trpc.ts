import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import { timingSafeEqual } from "node:crypto";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const ADMIN_WRITE_ERR_MSG = "ADMIN_KEY_REQUIRED: 管理者または @atsu-maru.co.jp アカウントでのログインが必要です";
export const ALLOWED_EDITOR_EMAIL_DOMAIN = "@atsu-maru.co.jp";

export function isAllowedEditorUser(user: TrpcContext["user"] | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  const email = (user.email ?? "").trim().toLowerCase();
  return email.length > ALLOWED_EDITOR_EMAIL_DOMAIN.length && email.endsWith(ALLOWED_EDITOR_EMAIL_DOMAIN);
}

function extractAdminToken(req: TrpcContext["req"]): string {
  const headerKey = req.headers["x-admin-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) {
    return headerKey.trim();
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return "";
}

function safeTokenMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const writeProtectedProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    // 1. Signed-in admin or @atsu-maru.co.jp member session is allowed
    if (isAllowedEditorUser(ctx.user)) {
      return next();
    }

    // 2. Check ADMIN_API_KEY via x-admin-api-key or Authorization: Bearer <key>
    const expectedKey = (process.env.ADMIN_API_KEY ?? "").trim();
    const providedKey = extractAdminToken(ctx.req);

    if (expectedKey && safeTokenMatch(providedKey, expectedKey)) {
      return next();
    }

    // 3. Fail-closed: reject unauthenticated write requests
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ADMIN_WRITE_ERR_MSG,
    });
  }),
);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
