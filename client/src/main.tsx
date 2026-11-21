import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

const ADMIN_KEY_STORAGE = "iketeru_admin_api_key";

// Clean up any legacy persistent localStorage admin key (shared-device mitigation)
if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    // ignore storage errors
  }
}

const handleAuthErrors = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  if (error.message.includes("ADMIN_KEY_REQUIRED")) {
    const entered = window.prompt(
      "編集・お気に入り保存には管理者または @atsu-maru.co.jp アカウントでのログイン、または管理者APIキー（タブを閉じると自動消去）が必要です。キーを入力してください："
    );
    if (entered && entered.trim()) {
      window.sessionStorage.setItem(ADMIN_KEY_STORAGE, entered.trim());
      window.alert("管理者APIキーをこのタブのセッションに一時保存しました。もう一度操作を実行してください。");
    }
    return;
  }

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;
  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    handleAuthErrors(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    handleAuthErrors(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        if (typeof window === "undefined") return {};
        const key = window.sessionStorage.getItem(ADMIN_KEY_STORAGE);
        return key ? { "x-admin-api-key": key } : {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
