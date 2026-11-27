import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getAllVideos: vi.fn(async () => []),
  getVideoCount: vi.fn(async () => 0),
  getVideoById: vi.fn(async () => null),
  createVideo: vi.fn(async () => null),
  updateVideo: vi.fn(async () => null),
  deleteVideo: vi.fn(async () => undefined),
}));

import { appRouter } from "./routers";
import { getVideoById } from "./db";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

function createGuestContext(headers: Record<string, string> = {}): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers,
    } as TrpcContext["req"],
    res: {
      clearCookie: () => undefined,
    } as TrpcContext["res"],
  };
}

function createEditorContext(overrides: Partial<AuthenticatedUser> = {}): TrpcContext {
  return {
    user: {
      id: 2,
      openId: "editor-user",
      email: "editor@atsu-maru.co.jp",
      name: "Editor User",
      loginMethod: "oauth",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      ...overrides,
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => undefined,
    } as TrpcContext["res"],
  };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "none",
      httpOnly: true,
      path: "/",
    });
  });
});

describe("videos write-protected editing", () => {
  const TEST_ADMIN_KEY = "test-admin-api-key-independent-of-env";
  let prevAdminApiKey: string | undefined;

  const videoInput = {
    id: "sample-video",
    platform: "youtube" as const,
    title: "編集権限テスト動画",
    thumbnail: "",
    videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    embedUrl: "",
    source: "manual",
    sourceLabel: "手動追加",
    channelId: "",
    channelTitle: "",
    genres: [],
    products: [],
    directions: [],
    tones: [],
    tags: [],
    purposes: ["プロモーション"],
    expressions: [],
    toneEmotions: [],
    toneVisuals: [],
    toneTechniques: [],
    productions: [],
    privateRating: "B",
    addedDate: "2026-08-12",
  };

  beforeEach(() => {
    prevAdminApiKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = TEST_ADMIN_KEY;
    vi.mocked(getVideoById).mockReset();
    vi.mocked(getVideoById).mockResolvedValue(null);
  });

  afterEach(() => {
    if (prevAdminApiKey === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = prevAdminApiKey;
    }
  });

  it("rejects video write mutations from an unauthenticated guest (independent of .env)", async () => {
    delete process.env.ADMIN_API_KEY;
    const caller = appRouter.createCaller(createGuestContext());

    await expect(caller.videos.create(videoInput)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.videos.update({ ...videoInput, title: "更新済み動画" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.videos.delete({ id: "sample-video" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("permits video creation for an authorized @atsu-maru.co.jp editor", async () => {
    const caller = appRouter.createCaller(createEditorContext());

    await expect(caller.videos.create(videoInput)).resolves.toBeNull();
  });

  it("rejects a duplicate video before attempting a database insert", async () => {
    vi.mocked(getVideoById).mockResolvedValue({ id: videoInput.id } as never);
    const caller = appRouter.createCaller(createEditorContext());

    await expect(caller.videos.create(videoInput)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "この動画はすでに登録されています。既存の動画を一覧から編集してください。",
    });
  });

  it("permits video updates with a valid x-admin-api-key header", async () => {
    const caller = appRouter.createCaller(
      createGuestContext({ "x-admin-api-key": TEST_ADMIN_KEY })
    );

    await expect(caller.videos.update({ ...videoInput, title: "更新済み動画" })).resolves.toBeNull();
  });

  it("permits video deletion for an admin user", async () => {
    const caller = appRouter.createCaller(
      createEditorContext({ role: "admin", email: "admin@example.com" })
    );

    await expect(caller.videos.delete({ id: "sample-video" })).resolves.toEqual({ success: true });
  });
});
