import type { Fetch } from "@typesafe-ai/sdk";
import type { BackendSpec, TypeSafeOptions } from "pi-typesafe";
import { DEFAULT_BACKEND, backendHost, resolveBackend } from "pi-typesafe";

/** The judgment backend: a registry name ("typesafe", "openrouter", "commandcode") or a caller-supplied endpoint object. */
export type JudgmentBackend = BackendSpec;

/** The judgment destination as the config carries it, plus the refusal that turns judgments off when the configured value was refused. */
export interface BackendSetting {
  /** The spec judgments go to; undefined only when the configured value was refused. */
  readonly typesafeBackend: JudgmentBackend | undefined;
  /** Why the configured value was refused: the once-per-session notice and `/warden status` quote it. */
  readonly backendRefusal: string | undefined;
}

/** What a raw `typesafeBackend` value resolves to: the spec judgments go to, or the refusal that turns them off. Exactly one is set. */
export type BackendResolution =
  | { readonly typesafeBackend: JudgmentBackend; readonly backendRefusal?: undefined }
  | { readonly typesafeBackend?: undefined; readonly backendRefusal: string };

/** Why no judge is available: consent not given, the backend refused, no key for the backend, a saved 401 or 403, or the request budget spent. */
export type JudgmentsOffReason = "no_consent" | "bad_backend" | "no_key" | "key_rejected" | "budget";

/**
 * Resolve a raw config value to the spec judgments go to, kept as written, or to the refusal that turns judgments off.
 * pi-typesafe validates the spec again on every call. An unknown name or an object it refuses is never silently mapped
 * to the default backend: a mistyped value must not send judgments to api.typesafe.ai.
 */
export function resolveJudgmentBackend(raw: unknown): BackendResolution {
  if (raw === undefined || raw === null) return { typesafeBackend: DEFAULT_BACKEND };
  try {
    resolveBackend(raw as BackendSpec);
  } catch (error) {
    return { backendRefusal: error instanceof Error ? error.message : String(error) };
  }
  return { typesafeBackend: raw as JudgmentBackend };
}

/** The name messages show for a backend: the registry name, or an endpoint's validated label. */
export function backendName(backend: JudgmentBackend | undefined): string {
  return backend === undefined ? DEFAULT_BACKEND : typeof backend === "string" ? backend : resolveBackend(backend).label;
}

/** Whether `/typesafe login <backend>` can store this backend's key. It names a registry backend; an endpoint object cannot be named. */
export function loginStoresKey(backend: JudgmentBackend | undefined): boolean {
  return typeof (backend ?? DEFAULT_BACKEND) === "string";
}

/** One phrase naming where judgments go — the label, the host, and the model sent — for consent text and status lines. */
export function describeBackend(backend: JudgmentBackend | undefined): string {
  const resolved = resolveBackend(backend);
  return `${resolved.label} at ${backendHost(backend)}, model ${resolved.defaultModel ?? "none configured"}`;
}

/** Adapt the consent text to the active backend by substituting the destination host. */
export function disclosureFor(backend: JudgmentBackend | undefined, disclosure: string): string {
  return backend === undefined || backend === DEFAULT_BACKEND ? disclosure : disclosure.replace(backendHost(DEFAULT_BACKEND), backendHost(backend));
}

/**
 * Build the options forwarded to `createTypeSafe`.
 * The caller must gate on `authState({ backend }).usable` before calling `createTypeSafe`.
 * On Bun (the runtime Pi ships as), the SDK's response buffering breaks every judge call, so the
 * options carry a fetch that keeps it out of the body stream.
 */
export function judgeOptions(config: { maxRequests: number; timeoutMs: number; typesafeBackend: JudgmentBackend }): TypeSafeOptions {
  return {
    maxRequests: config.maxRequests,
    timeoutMs: config.timeoutMs,
    ...(config.typesafeBackend === DEFAULT_BACKEND ? {} : { backend: config.typesafeBackend }),
    ...(bunRuntime() ? { fetch: bufferedFetch() } : {}),
  };
}

/** Whether this process runs on Bun, the runtime Pi's compiled binary embeds. */
function bunRuntime(): boolean {
  return typeof process !== "undefined" && process.versions?.bun !== undefined;
}

/**
 * On Bun, the SDK's timeout wrapper attaches an AbortSignal to every fetch, and its buffering step
 * (`bufferResponse`) then acquires a ReadableStream reader on the original response body, releasing
 * it without reading. A signal-attached Bun response is marked used the moment any reader is
 * acquired, so the SDK's own later `res.text()` throws `TypeError: Body already used`, which
 * pi-typesafe reports as a "response" failure — every judgment fails. This transport reads the
 * body itself, inside the caller's signal window, and hands back a buffered response whose
 * `clone()` has no body: the SDK's buffering step sees no reader to take and returns early, never
 * locking the original stream. Timeouts still reject: the abort errors the body read here.
 */
export function bufferedFetch(base: Fetch = fetch as unknown as Fetch): Fetch {
  return (input, init) =>
    base(input, init).then(async (response) => {
      const text = await response.text();
      const headers = new Headers(response.headers);
      // The wire encoding is decoded and the byte length can differ, so neither still describes the body.
      headers.delete("content-encoding");
      headers.delete("content-length");
      const buffered = new Response(text, { status: response.status, statusText: response.statusText, headers });
      return new Proxy(buffered, {
        get(target, property) {
          if (property === "clone") return () => new Response(null, { status: target.status, statusText: target.statusText, headers: target.headers });
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }) as Promise<Response>;
}
