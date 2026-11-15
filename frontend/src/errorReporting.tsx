/**
 * Отслеживание ошибок интерфейса: необработанные ошибки, отклонённые промисы и падения React
 * уходят на POST /api/client-errors (сервер пишет их в лог и в метрику antistall_errors_total{source="client"}).
 * Одинаковые ошибки отправляются один раз, всего — не больше 10 за загрузку страницы.
 */
import { Component, type ReactNode } from "react";

const sent = new Set<string>();
const MAX_PER_PAGE = 10;

export function reportClientError(kind: "error" | "unhandledrejection" | "react", err: unknown) {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err ?? null));
  const key = `${kind}:${e.message}`;
  if (sent.has(key) || sent.size >= MAX_PER_PAGE) return;
  sent.add(key);
  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, message: e.message, stack: e.stack, url: location.pathname }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* отчёт об ошибке не должен ронять страницу */
  }
}

export function installErrorReporting() {
  window.addEventListener("error", (ev) => reportClientError("error", ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => reportClientError("unhandledrejection", ev.reason));
}

/** Падение React-дерева: отчёт на сервер и понятный экран вместо белого листа. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    reportClientError("react", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-center text-ink">
        <p className="font-display text-3xl">Что-то пошло не так</p>
        <p className="max-w-sm text-base text-mute">Мы уже получили отчёт об ошибке. Прогресс сохранён на сервере — обновите страницу.</p>
        <button type="button" onClick={() => location.reload()} className="as-btn as-btn-primary">Обновить</button>
      </main>
    );
  }
}
