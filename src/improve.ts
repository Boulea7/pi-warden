/**
 * `/warden improve`: one project-local pass over this project's own sessions. It reads the session files of this
 * project (the same source and cwd filter as `prefs.ts`), the project's rules log, and the per-session hold logs, then
 * prints three counts: what reading cost, what work was sent twice, and which refusals of the same kind repeated. From
 * those counts alone it proposes at most three changes to `pi-warden.md`, each carrying the number it came from and the
 * records it read; a proposal whose number is not in the printed list is refused before anything is written. Nothing is
 * sent anywhere: the model is not asked, so a missing key or a judge error cannot produce a half-written rules file.
 *
 * The quiet window is the one timed thing here. It is held in this session's own extension instance, carries the
 * arming session id and its expiry, and every guard asks it with its own session id, so a window armed by one session
 * never silences another. It expires by the clock: no timer, no state on disk, and no path that leaves a judge muted.
 */
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { userConfigPath } from "./config.js";
import type { HostDirs } from "./host-dirs.js";
import { defaultHostDirs } from "./host-dirs.js";
import { isHumanTyped, jaccard, projectSessionFiles, SIMILARITY, tokens } from "./prefs.js";
import { redact } from "./redact.js";
import { buildRulesReport } from "./rules-report.js";
import type { RuleFlag, RuleReportRow } from "./rules-report.js";
import { readRulesLog, rulesLogPath } from "./rules-log.js";
import type { RuleRecord } from "./rules-log.js";
import type { WasteCall } from "./waste.js";
import { pagingNudge, recheckNudge, searchNudge, sleepNudge } from "./waste.js";

/** The window `/warden improve` reads when no number is given, and the most it accepts. */
export const IMPROVE_DEFAULT_DAYS = 7;
export const IMPROVE_MAX_DAYS = 90;
/** At most this many rule changes are proposed in one pass. */
export const IMPROVE_MAX_PROPOSALS = 3;
/** The default quiet window and the cap on it: ten minutes, never more than fifteen. */
export const QUIET_DEFAULT_MS = 600_000;
export const QUIET_MAX_MS = 900_000;
/** A rule edit needs this many recorded events behind it; one event is an accident, not a pattern. */
export const MIN_FIRED_PROPOSAL = 3;
export const MIN_REPEAT_PROPOSAL = 3;
/** Kept from the tool result for the waste detectors: enough for a failure line and a line count. */
const RESULT_KEEP = 4000;
/** A repeated request is compared on its content words, redacted and capped before that. */
const REQUEST_KEEP = 200;

const DAY_MS = 86_400_000;

/** A window in days: a plain positive integer, refused in one line otherwise. */
export type ImproveArgs = { days: number } | { error: string };

export function parseImproveArgs(text: string): ImproveArgs {
  const value = text.trim();
  if (!value) return { days: IMPROVE_DEFAULT_DAYS };
  if (!/^\d+$/.test(value)) {
    return { error: `warden: "${value.slice(0, 20)}" is not a whole number of days; use /warden improve 1 to ${IMPROVE_MAX_DAYS}. Nothing was read.` };
  }
  const days = Number(value);
  if (days < 1) return { error: `warden: the window is at least 1 day, so there is something to read. Nothing was read.` };
  if (days > IMPROVE_MAX_DAYS) return { error: `warden: ${value} days is above the ${IMPROVE_MAX_DAYS}-day cap. Nothing was read.` };
  return { days };
}

// ── the quiet window ─────────────────────────────────────────────────────────

/**
 * The rules judge's quiet window of one session. A guard reads it with its own session id, so a window armed by
 * another session is not this session's and changes nothing here. Expiry is the clock: once `until` has passed the
 * window is dead for every reader, whatever path left it armed.
 */
export class QuietWindow {
  private session: string | undefined;
  private until = 0;

  /** Arms (or re-arms) the window for one session; the cap and the one-second floor are applied here. */
  arm(session: string, ms: number, now = Date.now()): { until: number; ms: number } {
    if (!(ms > 0)) {
      this.disarm();
      return { until: 0, ms: 0 };
    }
    const capped = Math.min(Math.max(1_000, Math.trunc(ms)), QUIET_MAX_MS);
    this.session = session;
    this.until = now + capped;
    return { until: this.until, ms: capped };
  }

  /** Ends the window now; every exit path of a pass that did not write takes it. */
  disarm(): void {
    this.session = undefined;
    this.until = 0;
  }

  /** True only for the arming session, and only before the expiry. */
  active(session: string | undefined, now = Date.now()): boolean {
    return session !== undefined && session === this.session && this.until > now;
  }

  get expiresAt(): number {
    return this.until;
  }

  get armedBy(): string | undefined {
    return this.session;
  }

  /** One line for `/warden status` and the status line; undefined when the window is dead or not this session's. */
  statusLine(session: string | undefined, now = Date.now()): string | undefined {
    if (!this.active(session, now)) return undefined;
    const left = Math.max(1, Math.ceil((this.until - now) / 1000));
    const at = new Date(this.until).toISOString().slice(11, 16);
    return `rules judge quiet until ${at} (${Math.ceil(left / 60)} min left), armed by this session`;
  }
}

// ── reading this project's sessions ──────────────────────────────────────────

/** What one session file says about reading cost and repeated work. */
export interface SessionReading {
  path: string;
  /** The Pi session id, taken from the file name. */
  session: string;
  turns: number;
  toolCalls: number;
  wholeFileReads: number;
  /** The largest `usage.totalTokens` any assistant message recorded; undefined when the file records none. */
  peakContext?: number;
  /** The calls of this session, in order, with the result text the waste detectors read. */
  calls: WasteCall[];
  /** Redacted texts a person typed, for the repeated-request count. */
  requests: string[];
}

export function sessionIdOf(file: string): string {
  const name = basename(file).replace(/\.jsonl$/, "");
  const cut = name.lastIndexOf("_");
  return cut >= 0 ? name.slice(cut + 1) : name;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
    .map(part => part.text)
    .join("\n");
}

/**
 * One session file's counts, from the entries Pi writes: a `session` header with the cwd, `message` entries with role
 * `user` (a turn), `assistant` (with `usage.totalTokens` and `toolCall` content parts), and `toolResult` entries that
 * carry the output of the call with the same id. A line that does not parse is skipped, never guessed at.
 */
export function readSession(data: Buffer, path: string, cwd: string): SessionReading {
  const reading: SessionReading = { path, session: sessionIdOf(path), turns: 0, toolCalls: 0, wholeFileReads: 0, calls: [], requests: [] };
  const pending: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  const results = new Map<string, { text: string; failed: boolean }>();
  for (const line of data.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry: { type?: unknown; message?: { role?: unknown; content?: unknown; usage?: { totalTokens?: unknown } } };
    try {
      entry = JSON.parse(line);
    } catch {
      // A torn last line in a session that is still being written: the complete lines still count.
      continue;
    }
    if (entry.type !== "message" || !entry.message) continue;
    const role = entry.message.role;
    if (role === "user") {
      reading.turns++;
      const text = contentText(entry.message.content);
      if (isHumanTyped(text)) reading.requests.push(redact(text.replace(/\s+/g, " ").trim()).slice(0, REQUEST_KEEP));
      continue;
    }
    if (role === "assistant") {
      const total = entry.message.usage?.totalTokens;
      if (typeof total === "number" && Number.isFinite(total)) reading.peakContext = Math.max(reading.peakContext ?? 0, total);
      const content = entry.message.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const call = part as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
        if (call.type !== "toolCall" || typeof call.name !== "string") continue;
        const input = call.arguments && typeof call.arguments === "object" ? (call.arguments as Record<string, unknown>) : {};
        reading.toolCalls++;
        if (call.name === "read" && input.offset === undefined && input.limit === undefined) reading.wholeFileReads++;
        pending.push({ id: typeof call.id === "string" ? call.id : `#${reading.toolCalls}`, name: call.name, input });
      }
      continue;
    }
    if (role === "toolResult") {
      const id = (entry.message as { toolCallId?: unknown }).toolCallId;
      if (typeof id !== "string") continue;
      results.set(id, { text: contentText(entry.message.content).slice(0, RESULT_KEEP), failed: (entry.message as { isError?: unknown }).isError === true });
    }
  }
  reading.calls = pending.map(call => {
    const result = results.get(call.id);
    return { tool: call.name, input: call.input, cwd, failed: result?.failed ?? false, result: result?.text ?? "" };
  });
  return reading;
}

export interface SkippedSession {
  path: string;
  reason: string;
}

export interface SessionGather {
  readings: SessionReading[];
  skipped: SkippedSession[];
  /** Session files found inside the window, before the session cap. */
  found: number;
  directories: number;
}

/**
 * Reads every session file of this project inside the window. A file outside this project's session directories is
 * never listed; a file whose header names another cwd, or whose entries do not parse, is skipped and counted.
 */
export async function gatherSessions(options: {
  dir: string;
  cwd: string;
  exclude?: string | undefined;
  days: number;
  now?: number;
  maxSessions?: number;
}): Promise<SessionGather> {
  const now = options.now ?? Date.now();
  const oldest = now - options.days * DAY_MS;
  const { files, directories } = await projectSessionFiles({ dir: options.dir, cwd: options.cwd, exclude: options.exclude, oldest });
  const readings: SessionReading[] = [];
  const skipped: SkippedSession[] = [];
  for (const file of files.slice(0, options.maxSessions ?? files.length)) {
    const data = await readFile(file.path).catch(() => undefined);
    if (!data) {
      skipped.push({ path: file.path, reason: "unreadable" });
      continue;
    }
    const header = firstEntry(data);
    if (header && typeof header.cwd === "string" && header.cwd !== options.cwd) {
      skipped.push({ path: file.path, reason: `another project (${header.cwd})` });
      continue;
    }
    const headerCwd = typeof header?.cwd === "string" ? header.cwd : options.cwd;
    const reading = data.toString("utf8").trim() ? readSession(data, file.path, headerCwd) : undefined;
    if (!reading || (reading.turns === 0 && reading.toolCalls === 0)) {
      skipped.push({ path: file.path, reason: "no readable entries" });
      continue;
    }
    readings.push(reading);
  }
  return { readings, skipped, found: files.length, directories };
}

/** The `session` header of a session file, when it parses. */
function firstEntry(data: Buffer): { type?: unknown; cwd?: unknown } | undefined {
  const line = data.toString("utf8").split("\n", 1)[0] ?? "";
  try {
    const entry = JSON.parse(line) as { type?: unknown; cwd?: unknown };
    return entry.type === "session" ? entry : undefined;
  } catch {
    return undefined;
  }
}

// ── the three counts ─────────────────────────────────────────────────────────

export interface RepeatCounts {
  /** Calls a waste detector flagged: the same check, search, paging range, or wait sent twice. */
  total: number;
  byDetector: Record<"paging" | "search" | "recheck" | "sleep", number>;
  /** The session files each detector fired in, for the evidence line. */
  sessions: Record<"paging" | "search" | "recheck" | "sleep", string[]>;
}

export interface RefusalCounts {
  /** Holds recorded in the window, by kind: the pattern that held the call, or the tool. */
  holds: number;
  byKind: Array<{ kind: string; count: number }>;
  /** Rule judgments in the window. */
  judged: number;
  fired: number;
  cleared: number;
  byRule: RuleReportRow[];
  unheard: Array<{ id: string; name: string }>;
}

export interface ImproveCounts {
  days: number;
  since: number;
  until: number;
  sessions: number;
  skipped: number;
  turns: number;
  toolCalls: number;
  wholeFileReads: number;
  peakContext?: number;
  repeats: RepeatCounts;
  /** Requests a person typed that repeat an earlier one in the window. */
  repeatedRequests: number;
  refusals: RefusalCounts;
}

const DETECTORS = { paging: pagingNudge, search: searchNudge, recheck: recheckNudge, sleep: sleepNudge } as const;
/** The detector's own window: the last calls a repeat is judged over, the same span the guard uses. */
const WASTE_WINDOW = 10;

export function countRepeats(readings: readonly SessionReading[]): RepeatCounts {
  const counts: RepeatCounts = { total: 0, byDetector: { paging: 0, search: 0, recheck: 0, sleep: 0 }, sessions: { paging: [], search: [], recheck: [], sleep: [] } };
  for (const reading of readings) {
    for (let index = 0; index < reading.calls.length; index++) {
      const window = reading.calls.slice(Math.max(0, index - WASTE_WINDOW + 1), index + 1);
      for (const [name, detect] of Object.entries(DETECTORS) as Array<[keyof RepeatCounts["byDetector"], (calls: readonly WasteCall[]) => unknown]>) {
        if (!detect(window)) continue;
        counts.byDetector[name]++;
        counts.total++;
        if (!counts.sessions[name].includes(reading.path)) counts.sessions[name].push(reading.path);
      }
    }
  }
  return counts;
}

export function countRepeatedRequests(readings: readonly SessionReading[], similarity = SIMILARITY): number {
  let repeats = 0;
  const seen: string[][] = [];
  for (const reading of readings) {
    for (const request of reading.requests) {
      const words = tokens(request);
      if (!words.length) continue;
      if (seen.some(earlier => jaccard(earlier, words) >= similarity)) repeats++;
      seen.push(words);
    }
  }
  return repeats;
}

export interface ImproveInput {
  days: number;
  now: number;
  readings: readonly SessionReading[];
  skipped: readonly SkippedSession[];
  ruleRecords: readonly RuleRecord[];
  holds: ReadonlyArray<{ kind: string }>;
  currentRules: ReadonlyArray<{ id: string; name: string }>;
}

export function computeCounts(input: ImproveInput): ImproveCounts {
  const report = buildRulesReport(input.ruleRecords, { days: input.days, now: input.now, currentRules: input.currentRules, source: "live" });
  const byKind = new Map<string, number>();
  for (const hold of input.holds) byKind.set(hold.kind, (byKind.get(hold.kind) ?? 0) + 1);
  return {
    days: input.days,
    since: input.now - input.days * DAY_MS,
    until: input.now,
    sessions: input.readings.length,
    skipped: input.skipped.length,
    turns: input.readings.reduce((sum, reading) => sum + reading.turns, 0),
    toolCalls: input.readings.reduce((sum, reading) => sum + reading.toolCalls, 0),
    wholeFileReads: input.readings.reduce((sum, reading) => sum + reading.wholeFileReads, 0),
    ...(input.readings.some(reading => reading.peakContext !== undefined)
      ? { peakContext: Math.max(...input.readings.map(reading => reading.peakContext ?? 0)) }
      : {}),
    repeats: countRepeats(input.readings),
    repeatedRequests: countRepeatedRequests(input.readings),
    refusals: {
      holds: input.holds.length,
      byKind: [...byKind].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
      judged: report.records,
      fired: report.rows.reduce((sum, row) => sum + row.fired, 0),
      cleared: report.rows.reduce((sum, row) => sum + row.cleared, 0),
      byRule: report.rows,
      unheard: report.unheard,
    },
  };
}

/** Every number the pass prints, as the list the cited-number check validates against. */
export function countLines(counts: ImproveCounts): Array<{ label: string; value: number | string }> {
  return [
    { label: "session files read", value: counts.sessions },
    { label: "session files skipped", value: counts.skipped },
    { label: "turns", value: counts.turns },
    { label: "tool calls", value: counts.toolCalls },
    { label: "whole-file reads", value: counts.wholeFileReads },
    { label: "peak context", value: counts.peakContext === undefined ? "unavailable" : counts.peakContext },
    { label: "repeated calls", value: counts.repeats.total },
    { label: "repeated requests", value: counts.repeatedRequests },
    { label: "rule judgments", value: counts.refusals.judged },
    { label: "rules fired", value: counts.refusals.fired },
    { label: "cleared on a later edit", value: counts.refusals.cleared },
    { label: "holds", value: counts.refusals.holds },
  ];
}

/** The numbers a proposal may cite: those the count list prints as values. */
export function citedNumbers(counts: ImproveCounts): Set<number> {
  return new Set(countLines(counts).map(line => line.value).filter((value): value is number => typeof value === "number"));
}

export function formatCounts(counts: ImproveCounts): string {
  const lines = countLines(counts).map(line => `${line.label}: ${line.value}`
    + (line.label === "tool calls" && counts.turns ? ` (${(counts.toolCalls / counts.turns).toFixed(1)} per turn)` : ""));
  const perRule = counts.refusals.byRule
    .filter(row => row.judged > 0)
    .slice(0, 6)
    .map(row => `${row.name} ${row.fired}/${row.judged}${row.flags.length ? ` (${row.flags.join(", ")})` : ""}`);
  if (perRule.length) lines.push(`per rule: ${perRule.join("; ")}`);
  const detectors = (Object.entries(counts.repeats.byDetector) as Array<[string, number]>).filter(([, count]) => count > 0);
  if (detectors.length) lines.push(`repeats by kind: ${detectors.map(([kind, count]) => `${kind} ${count}`).join(", ")}`);
  if (counts.refusals.byKind.length) lines.push(`holds by kind: ${counts.refusals.byKind.slice(0, 6).map(hold => `${hold.kind} ${hold.count}`).join(", ")}`);
  return lines.join("\n");
}

// ── proposals ────────────────────────────────────────────────────────────────

export type ProposalKind = "clarify" | "add";

export interface ImproveProposal {
  kind: ProposalKind;
  /** The id of the rule it changes, or "new" for a rule the file does not hold yet. */
  ruleId: string;
  title: string;
  /** The lines the proposal replaces; empty for an added section. */
  oldText: string;
  newText: string;
  /** The number it came from, and the label of that number in the printed list. */
  count: { label: string; value: number };
  /** The records it read: session files, the rules log, the hold logs. */
  evidence: string[];
  /** One line for the screen. */
  why: string;
}

export interface ProposalInput {
  counts: ImproveCounts;
  /** The rules text as the file holds it, before any change. */
  rulesText: string;
  rules: ReadonlyArray<{ id: string; name: string }>;
  /** The rule records in the window, for the session ids a clarify proposal cites. */
  ruleRecords: readonly RuleRecord[];
  logPath: string;
}

/** A measured line the pass adds to a rule it has changed before; the same rule is updated, never duplicated. */
const MEASURED = /^Measured \d{4}-\d{2}-\d{2}: /;

/** The heading a detector's new rule gets, which is also how a second pass knows the rule is already there. */
const DETECTOR_RULE: Record<keyof RepeatCounts["byDetector"], { heading: string; body: string }> = {
  paging: {
    heading: "Read a file in one call",
    body: "Read one file with one `read` call, using `offset` and `limit` to cover the range you need. Do not page through the same file in adjacent ranges.",
  },
  search: {
    heading: "Search a file once",
    body: "Search one file with one `grep` or `rg` call, with the pattern that finds the line. Do not run a second search on the same file with an overlapping pattern.",
  },
  recheck: {
    heading: "Run a check once",
    body: "Run a check once without a pipe, so its full output arrives. Do not re-run the same check with a different filter on its output.",
  },
  sleep: {
    heading: "Wait once",
    body: "Wait for slow work with one blocking command or one sleep long enough. Do not poll with a sleep in a loop.",
  },
};

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** The lines of one rule's section: its heading through the line before the next heading of the same level. */
export function ruleSection(rulesText: string, name: string): { start: number; end: number } | undefined {
  const lines = rulesText.split("\n");
  let level = 0;
  let start = -1;
  for (let index = 0; index < lines.length; index++) {
    const match = HEADING.exec(lines[index]!);
    if (!match) continue;
    if (start < 0) {
      if (match[2] !== name) continue;
      start = index;
      level = match[1]!.length;
      continue;
    }
    if (match[1]!.length <= level) return { start, end: index };
  }
  return start < 0 ? undefined : { start, end: lines.length };
}

/** The measured line a rule carries, with the day it was measured and the two counts behind it. */
export function measuredLine(name: string, day: string, row: { fired: number; judged: number }, days: number, worstPath?: string): string {
  const where = worstPath ? `, most often on \`${worstPath}\`` : "";
  return `Measured ${day}: ${row.fired} of ${row.judged} judgments against "${name}" in the last ${days} day${days === 1 ? "" : "s"} were violations${where}.`;
}

/**
 * At most three changes, ranked by the count behind each. A rule that fired MIN_FIRED_PROPOSAL times gets the count
 * written into it (or an existing measured line replaced with the fresh count); a repeat in the sessions with no rule
 * covering it gets a new rule. A rule the count does not reach is left alone: no rule is added to look busy.
 */
export function buildProposals(input: ProposalInput): ImproveProposal[] {
  const proposals: ImproveProposal[] = [];
  const day = new Date(input.counts.until).toISOString().slice(0, 10);
  const byId = new Map(input.rules.map(rule => [rule.id, rule]));
  for (const row of input.counts.refusals.byRule) {
    if (row.fired < MIN_FIRED_PROPOSAL || !byId.has(row.id)) continue;
    const section = ruleSection(input.rulesText, byId.get(row.id)!.name);
    if (!section) continue;
    const lines = input.rulesText.split("\n");
    const body = lines.slice(section.start, section.end);
    const existing = body.findIndex(line => MEASURED.test(line.trim()));
    const fresh = measuredLine(row.name, day, row, input.counts.days, worstPathFor(input.ruleRecords, row.id));
    const evidence = [input.logPath, ...new Set(input.ruleRecords.filter(record => record.id === row.id).map(record => record.session))];
    if (existing >= 0) {
      proposals.push({
        kind: "clarify", ruleId: row.id, title: byId.get(row.id)!.name,
        oldText: body[existing]!, newText: fresh,
        count: { label: "rules fired", value: row.fired }, evidence,
        why: `"${row.name}" fired ${row.fired} of ${row.judged} times; its measured line is brought up to date.`,
      });
      continue;
    }
    const insertAt = lastContentIndex(body) + 1;
    const withLine = [...body.slice(0, insertAt), "", fresh, ...body.slice(insertAt)];
    proposals.push({
      kind: "clarify", ruleId: row.id, title: byId.get(row.id)!.name,
      oldText: body.join("\n"), newText: withLine.join("\n"),
      count: { label: "rules fired", value: row.fired }, evidence,
      why: `"${row.name}" fired ${row.fired} of ${row.judged} times; the count goes into the rule.`,
    });
  }
  const repeats = Object.entries(input.counts.repeats.byDetector) as Array<[keyof RepeatCounts["byDetector"], number]>;
  repeats.sort((a, b) => b[1] - a[1]);
  for (const [kind, count] of repeats) {
    if (count < MIN_REPEAT_PROPOSAL) continue;
    const rule = DETECTOR_RULE[kind];
    if (input.rulesText.includes(rule.heading)) continue;
    proposals.push({
      kind: "add", ruleId: "new", title: rule.heading,
      oldText: "",
      newText: `## ${rule.heading}\n${rule.body}\n\nMeasured ${day}: ${count} repeated ${kind === "sleep" ? "waits" : kind === "paging" ? "range reads" : kind === "search" ? "searches" : "checks"} in the last ${input.counts.days} day${input.counts.days === 1 ? "" : "s"}.`,
      count: { label: "repeated calls", value: count },
      evidence: input.counts.repeats.sessions[kind],
      why: `${count} repeated ${kind} calls in this project's sessions, and no rule covers them.`,
    });
  }
  return proposals.sort((a, b) => b.count.value - a.count.value || a.title.localeCompare(b.title)).slice(0, IMPROVE_MAX_PROPOSALS);
}

/** The path a rule fired on most in the window, when the records name one more than once. */
function worstPathFor(records: readonly RuleRecord[], id: string): string | undefined {
  const counts = new Map<string, number>();
  for (const record of records) if (record.id === id && record.finding) counts.set(record.path, (counts.get(record.path) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 1 ? best[0] : undefined;
}

function lastContentIndex(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index--) if (lines[index]!.trim()) return index;
  return 0;
}

/**
 * The whole proposal set is refused when any proposal cites a number the pass did not print: a rule edit no count
 * supports never reaches the file, and neither does the rest of the set it arrived in.
 */
export function validateProposals(proposals: readonly ImproveProposal[], counts: ImproveCounts): string | undefined {
  const printed = citedNumbers(counts);
  for (const proposal of proposals) {
    if (!printed.has(proposal.count.value)) {
      return `warden: a proposal cites ${proposal.count.label} ${proposal.count.value}, which this pass did not print; nothing was written.`;
    }
  }
  return undefined;
}

/** The rules text with every proposal applied; a proposal whose old text is gone is skipped, never guessed at. */
export function applyProposals(rulesText: string, proposals: readonly ImproveProposal[]): string {
  let text = rulesText;
  for (const proposal of proposals) {
    if (!proposal.oldText) {
      text = `${text.replace(/\s*$/, "")}\n\n${proposal.newText}\n`;
      continue;
    }
    const at = text.indexOf(proposal.oldText);
    if (at < 0) continue;
    text = `${text.slice(0, at)}${proposal.newText}${text.slice(at + proposal.oldText.length)}`;
  }
  return text;
}

/** One line per proposal, with the count and the records behind it. */
export function formatProposals(proposals: readonly ImproveProposal[]): string {
  if (!proposals.length) return "";
  return proposals.map((proposal, index) => [
    `${index + 1}. ${proposal.kind === "add" ? "add rule" : "clarify rule"} "${proposal.title}" — ${proposal.count.label} ${proposal.count.value}`,
    `   ${proposal.why}`,
    `   read: ${proposal.evidence.join(", ")}`,
  ].join("\n")).join("\n");
}

/** The one line a pass with nothing to change prints, with the counts that show it. */
export function formatHeld(counts: ImproveCounts, rules: number): string {
  return `The rules held in the last ${counts.days} day${counts.days === 1 ? "" : "s"}: ${rules} rule${rules === 1 ? "" : "s"} judged ${counts.refusals.judged} time${counts.refusals.judged === 1 ? "" : "s"}, ${counts.refusals.fired} fired, ${counts.refusals.cleared} cleared on a later edit, ${counts.repeats.total} repeated calls in ${counts.sessions} session${counts.sessions === 1 ? "" : "s"}; nothing to change in pi-warden.md.`;
}

export function formatEmpty(days: number): string {
  return `Nothing to learn from yet: this project has no recorded sessions in the last ${days} day${days === 1 ? "" : "s"}.`;
}

// ── the diff and the write ───────────────────────────────────────────────────

/** One hunk of a line diff: the lines removed and added at one place, with the line number on each side. */
export interface DiffHunk {
  at: number;
  removed: string[];
  added: string[];
}

/** Line-level hunks between two texts, longest common subsequence, so the screen and the file agree. */
export function diffLines(before: string, after: string): DiffHunk[] {
  const left = before.split("\n");
  const right = after.split("\n");
  const lengths: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      lengths[i]![j] = left[i] === right[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  let current: DiffHunk | undefined;
  const open = (at: number) => {
    current ??= { at, removed: [], added: [] };
    return current;
  };
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      if (current) { hunks.push(current); current = undefined; }
      i++;
      j++;
      continue;
    }
    if (j < right.length && (i >= left.length || lengths[i]![j + 1]! >= lengths[i + 1]![j]!)) {
      open(i + 1).added.push(right[j]!);
      j++;
      continue;
    }
    open(i + 1).removed.push(left[i]!);
    i++;
  }
  if (current) hunks.push(current);
  return hunks;
}

/** The diff as the screen shows it: context kept to one line either side, the rest elided. */
export function formatDiff(before: string, after: string, context = 1): string {
  const hunks = diffLines(before, after);
  if (!hunks.length) return "no change";
  const left = before.split("\n");
  const out: string[] = [];
  let shown = -2;
  for (const hunk of hunks) {
    if (hunk.at - shown > context + 2) out.push(`@@ line ${hunk.at}`);
    else for (let index = Math.max(shown + 1, hunk.at - context); index < hunk.at - 1; index++) out.push(`  ${left[index] ?? ""}`);
    for (const line of hunk.removed) out.push(`- ${line}`);
    for (const line of hunk.added) out.push(`+ ${line}`);
    shown = hunk.at - 1;
  }
  return out.join("\n");
}

/** The backup path beside the file: the file name, the UTC time, and `.bak`. */
export function backupPathFor(file: string, now = Date.now()): string {
  return `${file}.bak-${new Date(now).toISOString().replace(/[:.]/g, "-")}`;
}

export interface WriteResult {
  backup?: string;
  error?: string;
}

/**
 * Writes the new rules file: a timestamped backup first, then the file through a temporary name and a rename. The file
 * must still hold the text the pass read; when it changed under us the write is refused and the pass re-runs.
 */
export async function writeRulesFile(options: { file: string; before: string; after: string; now?: number }): Promise<WriteResult> {
  let current: string;
  try {
    current = await readFile(options.file, "utf8");
  } catch (error) {
    return { error: `warden: ${options.file} could not be read (${error instanceof Error ? error.message : String(error)}); nothing was written.` };
  }
  if (current !== options.before) return { error: "warden: pi-warden.md changed since this pass read it; nothing was written. Run /warden improve again." };
  const backup = backupPathFor(options.file, options.now);
  try {
    await writeFileAtomic(backup, options.before);
    await writeFileAtomic(options.file, options.after);
  } catch (error) {
    return { error: `warden: writing pi-warden.md failed (${error instanceof Error ? error.message : String(error)}); the backup is at ${backup}.` };
  }
  return { backup };
}

// ── the hold logs ────────────────────────────────────────────────────────────

/**
 * The holds recorded in the window for the given sessions, by kind. The hold log is one file per session, named
 * `<date>-<session>.jsonl`, so the window is read from the file name and the project from the session ids.
 */
export async function readHolds(options: {
  sessions: readonly string[];
  days: number;
  now?: number;
  dirs?: HostDirs;
}): Promise<Array<{ kind: string; at: number; session: string }>> {
  const dirs = options.dirs ?? defaultHostDirs();
  const dir = join(dirname(userConfigPath(dirs)), "holds");
  const names = await readdir(dir).catch(() => [] as string[]);
  const since = (options.now ?? Date.now()) - options.days * DAY_MS;
  const wanted = new Set(options.sessions);
  const holds: Array<{ kind: string; at: number; session: string }> = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const session = name.replace(/\.jsonl$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
    if (!wanted.has(session)) continue;
    const text = await readFile(join(dir, name), "utf8").catch(() => undefined);
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let record: { at?: unknown; tool?: unknown; patterns?: unknown; held?: unknown };
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof record.at !== "number" || record.at < since || record.held !== true) continue;
      const patterns = Array.isArray(record.patterns) ? record.patterns.filter((value): value is string => typeof value === "string") : [];
      holds.push({ kind: patterns[0] ?? (typeof record.tool === "string" ? record.tool : "hold"), at: record.at, session });
    }
  }
  return holds;
}

// ── the whole pass ───────────────────────────────────────────────────────────

export interface ImproveRun {
  days: number;
  elapsedMs: number;
  budgetMs: number;
  /** The rules file this pass would edit, when the project has one at the root. */
  file?: string;
  before?: string;
  after?: string;
  counts: ImproveCounts;
  proposals: ImproveProposal[];
  /** Set when the proposal set was refused; nothing is written then. */
  refusal?: string;
  /** The session files read and the ones skipped, printed so the run hides nothing. */
  read: string[];
  skipped: SkippedSession[];
  rulesSource?: string;
  /** Why no rule edit was possible at all (no rules file, a fallback document, a cap). */
  rulesNote?: string;
}

export function rulesLogFile(cwd: string, dirs: HostDirs = defaultHostDirs()): string {
  return rulesLogPath(cwd, dirs);
}

/** The project's rules log and hold records, read once; a missing file is an empty log. */
export async function readRecords(cwd: string, dirs: HostDirs, readings: readonly SessionReading[], days: number, now: number) {
  const logPath = rulesLogPath(cwd, dirs);
  const records = await readRulesLog(logPath);
  const holds = await readHolds({ sessions: readings.map(reading => reading.session), days, now, dirs });
  return { logPath, records, holds };
}
