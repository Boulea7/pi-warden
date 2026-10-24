/** Types for eval/config.mjs. */

export type PriceWindow = "peak" | "off-peak" | "flat";

export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface PriceEntry {
  peak?: Rates;
  "off-peak"?: Rates;
  flat?: Rates;
  window?: (atMs: number) => "peak" | "off-peak" | null;
  source: string;
  holidaySource?: string;
  billed: boolean;
}

export const PRICE_SOURCES: { deepseek: string; anthropic: string; xiaomi: string; holidays: string; typesafeJev: string; subqJev: string };
export const CHINESE_HOLIDAYS: Record<number, [string, string][]>;
export const PRICES: Record<string, PriceEntry>;
export interface JevBackend {
  label: string;
  keyEnv: string;
  inputUsdPerMTok: number;
  source: string;
}
export const JEV_BACKENDS: Record<string, JevBackend>;
export const JEV_PRICE: { perRequestUsd: number; inputUsdPerMTok: number; outputUsdPerMTok: number };
export function jevPrice(backend: string): { perRequestUsd: number; inputUsdPerMTok: number; outputUsdPerMTok: number } | null;
export function deepseekWindow(atMs: number): "peak" | "off-peak" | null;
export function priceFor(model: string, atMs?: number): (Rates & { window: PriceWindow }) | null;
export function hasPrice(model: string): boolean;
