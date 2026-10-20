import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  applyProposals, buildProposals, computeCounts, countLines, countRepeatedRequests, countRepeats, formatDiff, formatEmpty,
  formatHeld, gatherSessions, IMPROVE_MAX_DAYS, IMPROVE_MAX_PROPOSALS, IMPROVE_DEFAULT_DAYS, MIN_FIRED_PROPOSAL, parseImproveArgs,
  QuietWindow, readSession, ruleSection, validateProposals, writeRulesFile, QUIET_MAX_MS,
} from "../src/improve.js";
import type { ImproveCounts, ImproveProposal, SessionReading } from "../src/improve.js";
import type { RuleRecord } from "../src/rules-log.js";

const NOW = Date.parse("2026-01-05T00:00:00.000Z");
const CWD = "/scratch/project";

// ── builders ────────────────────────────────────────────────────────────────

interface Entry { type?: string; timestamp?: string; message?: Record<string, unknown>; cwd?: string; toolCallId?: string }

function sessionFile(cwd: string, entries: Entry[], at = "2026-01-04T10:00:00.000Z"): Buffer {
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: at, cwd }),
    JSON.stringify({ type: "session_info", id: "i1", timestamp: at, name: "drive" }),
    ...entries.map(entry => JSON.stringify(entry)),
  ];
  return Buffer.from(`${lines.join("\n")}\n`);
}

function user(text: string, at = "2026-01-04T10:01:00.000Z"): Entry {
  return { type: "message", timestamp: at, message: { role: "user", content: text } };
}

function assistant(calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>, totalTokens?: number): Entry {
  return {
    type: "message",
    timestamp: "2026-01-04T10:02:00.000Z",
    message: {
      role: "assistant",
      content: calls.map(call => ({ type: "toolCall", id: call.id, name: call.name, arguments: call.arguments })),
      ...(totalTokens === undefined ? {} : { usage: { input: totalTokens - 10, output: 10, totalTokens } }),
    },
  };
}

function result(id: string, text: string, isError = false): Entry {
  return { type: "message", timestamp: "2026-01-04T10:03:00.000Z", message: { role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text }], isError } };
}

function reading(path: string, calls: SessionReading["calls"], requests: string[] = []): SessionReading {
  return { path, session: "s1", turns: requests.length, toolCalls: calls.length, wholeFileReads: 0, calls, requests };
}

function ruleRecord(over: Partial<RuleRecord>): RuleRecord {
  return {
    at: "2026-01-04T10:00:00.000Z", session: "s1", path: "src/a.ts", tool: "write", id: "small-commits", name: "Small commits",
    outcome: "violation", violation: 0.9, threshold: 0.7, finding: true, ...over,
  };
}

const RULES = [
  "# Project rules",
  "",
  "## Small commits",
  "Keep each commit to one change.",
  "",
  "## Explain every command",
  "Say why before a command runs.",
  "",
].join("\n");

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-warden-improve-"));
});

after(() => rm(dir, { recursive: true, force: true }));

// ── the window argument ─────────────────────────────────────────────────────

test("window: 0, -1, 4.2, abc and 91 are each refused in one line, and 4 means four days", () => {
  assert.deepEqual(parseImproveArgs(""), { days: IMPROVE_DEFAULT_DAYS });
  assert.deepEqual(parseImproveArgs("4"), { days: 4 });
  assert.deepEqual(parseImproveArgs("1"), { days: 1 });
  for (const value of ["0", "-1", "4.2", "abc", "91", String(IMPROVE_MAX_DAYS + 1)]) {
    const parsed = parseImproveArgs(value);
    assert.ok("error" in parsed, `${value} must be refused`);
    assert.equal(parsed.error.split("\n").length, 1, `${value} is refused in one line`);
    assert.match(parsed.error, /Nothing was read/);
  }
  assert.match((parseImproveArgs("900") as { error: string }).error, new RegExp(`above the ${IMPROVE_MAX_DAYS}-day cap`));
});

// ── one session's counts ────────────────────────────────────────────────────

test("reading cost: turns, tool calls, whole-file reads and peak context come from the session file, not from a guess", () => {
  const data = sessionFile(CWD, [
    user("first turn"),
    assistant([
      { id: "a", name: "read", arguments: { path: "src/a.ts" } },
      { id: "b", name: "read", arguments: { path: "src/b.ts", offset: 1, limit: 20 } },
      { id: "c", name: "bash", arguments: { command: "ls" } },
    ], 21000),
    result("a", "file text"),
    user("second turn"),
    assistant([{ id: "d", name: "grep", arguments: { pattern: "x", path: "src/a.ts" } }], 32000),
  ]);
  const read = readSession(data, `${CWD}/2026-01-04T10-00-00-000Z_s1.jsonl`, CWD);
  assert.equal(read.session, "s1");
  assert.equal(read.turns, 2);
  assert.equal(read.toolCalls, 4);
  assert.equal(read.wholeFileReads, 1, "only the read with no offset and no limit covered a whole file");
  assert.equal(read.peakContext, 32000);
  assert.deepEqual(read.requests, ["first turn", "second turn"]);
  assert.equal(read.calls[0]!.result, "file text", "the tool result is matched to its call by id");
});

test("a session file with no recorded usage reports peak context as unavailable, never as zero", () => {
  const read = readSession(sessionFile(CWD, [user("one"), assistant([{ id: "a", name: "ls", arguments: {} }])]), join(CWD, "x_s2.jsonl"), CWD);
  assert.equal(read.peakContext, undefined);
  const counts = computeCounts({ days: 1, now: NOW, readings: [read], skipped: [], ruleRecords: [], holds: [], currentRules: [] });
  assert.equal(countLines(counts).find(line => line.label === "peak context")!.value, "unavailable");
});

test("gathering skips a session file from another project and one that does not parse, and says why", async () => {
  const sessions = await mkdtemp(join(dir, "sessions-"));
  await writeFile(join(sessions, "2026-01-04T10-00-00-000Z_ours.jsonl"), sessionFile(CWD, [user("hello")]));
  await writeFile(join(sessions, "2026-01-04T10-00-00-000Z_other.jsonl"), sessionFile("/scratch/other", [user("hello")]));
  await writeFile(join(sessions, "2026-01-04T10-00-00-000Z_torn.jsonl"), Buffer.from('{"type":"session","cwd":"/scratch/project"}\nnot json\n{"type":"message","message":{"role":"user","content":"hi"}}\n'));
  const gather = await gatherSessions({ dir: sessions, cwd: CWD, days: 30, now: NOW });
  assert.equal(gather.readings.length, 2, "our session and the torn one with one readable line are read");
  assert.deepEqual(gather.skipped.map(skip => skip.reason), ["another project (/scratch/other)"]);
});

test("gathering counts a file whose entries are all unreadable as skipped, so an empty file is never a finding", async () => {
  const sessions = await mkdtemp(join(dir, "empty-"));
  await writeFile(join(sessions, "2026-01-04T10-00-00-000Z_none.jsonl"), sessionFile(CWD, []));
  const gather = await gatherSessions({ dir: sessions, cwd: CWD, days: 30, now: NOW });
  assert.equal(gather.readings.length, 0);
  assert.equal(gather.skipped.length, 1);
  assert.match(gather.skipped[0]!.reason, /no readable entries/);
});

// ── repeated work ───────────────────────────────────────────────────────────

test("repeats: a page-through is counted by the guard's own paging detector, one flagged call per read past the third", () => {
  const pageThrough = (file: string, count: number) => [1, 21, 41, 61].slice(0, count)
    .map(start => ({ tool: "read", input: { path: file, offset: start, limit: 20 }, cwd: CWD, failed: false, result: "" }));
  const repeats = countRepeats([reading("a.jsonl", pageThrough("src/big.ts", 3))]);
  assert.equal(repeats.byDetector.paging, 1, "the third adjacent read is the first flagged one");
  assert.equal(repeats.total, 1);
  assert.deepEqual(repeats.sessions.paging, ["a.jsonl"]);
  assert.equal(countRepeats([reading("a.jsonl", pageThrough("src/big.ts", 2))]).total, 0, "two reads are not a page-through");
  assert.equal(countRepeats([reading("a.jsonl", pageThrough("src/big.ts", 4))]).byDetector.paging, 2);
});

test("repeats: the same request typed twice is counted; a different request is not", () => {
  const first = reading("a.jsonl", [], ["run the unit tests with coverage"]);
  const again = reading("b.jsonl", [], ["please run the unit tests with coverage"]);
  const other = reading("c.jsonl", [], ["write the changelog entry"]);
  assert.equal(countRepeatedRequests([first, again, other]), 1);
  assert.equal(countRepeatedRequests([first, other]), 0);
});

// ── nothing to learn, nothing written ───────────────────────────────────────

const emptyCounts = (): ImproveCounts => computeCounts({ days: 7, now: NOW, readings: [], skipped: [], ruleRecords: [], holds: [], currentRules: [] });

test("an empty record set prints 'nothing to learn from yet' and proposes nothing", () => {
  const counts = emptyCounts();
  assert.equal(counts.sessions, 0);
  assert.match(formatEmpty(7), /no recorded sessions in the last 7 days/);
  const proposals = buildProposals({ counts, rulesText: RULES, rules: [{ id: "small-commits", name: "Small commits" }], ruleRecords: [], logPath: "/log.jsonl" });
  assert.deepEqual(proposals, []);
});

test("no support: a rule that fired below the floor yields no proposal and the pass says the rules held", () => {
  const records = [ruleRecord({}), ruleRecord({ at: "2026-01-04T11:00:00.000Z" })];
  const counts = computeCounts({ days: 7, now: NOW, readings: [reading("a.jsonl", [])], skipped: [], ruleRecords: records, holds: [], currentRules: [{ id: "small-commits", name: "Small commits" }] });
  const proposals = buildProposals({ counts, rulesText: RULES, rules: [{ id: "small-commits", name: "Small commits" }], ruleRecords: records, logPath: "/log.jsonl" });
  assert.deepEqual(proposals, [], `two firings is under the ${MIN_FIRED_PROPOSAL} floor`);
  const held = formatHeld(counts, 1);
  assert.match(held, /The rules held in the last 7 days/);
  assert.match(held, /2 fired/);
});

// ── proposals, the count they cite, and the diff ────────────────────────────

function supportedCounts(): { counts: ImproveCounts; records: RuleRecord[] } {
  const records = [
    ruleRecord({ path: "src/a.ts" }), ruleRecord({ path: "src/a.ts" }), ruleRecord({ path: "src/b.ts" }),
    ruleRecord({ id: "explain-every-command", name: "Explain every command", finding: false, violation: 0.1, outcome: "compliant", path: "src/c.ts" }),
  ];
  const counts = computeCounts({
    days: 7, now: NOW, readings: [reading("2026-01-04T10-00-00-000Z_s1.jsonl", [])], skipped: [], ruleRecords: records, holds: [],
    currentRules: [{ id: "small-commits", name: "Small commits" }, { id: "explain-every-command", name: "Explain every command" }],
  });
  return { counts, records };
}

test("proposal: a rule that fired three times gets the count written into its section, and only that section changes", () => {
  const { counts, records } = supportedCounts();
  const proposals = buildProposals({ counts, rulesText: RULES, rules: [{ id: "small-commits", name: "Small commits" }, { id: "explain-every-command", name: "Explain every command" }], ruleRecords: records, logPath: "/log.jsonl" });
  assert.equal(proposals.length, 1);
  const proposal = proposals[0]!;
  assert.equal(proposal.ruleId, "small-commits");
  assert.equal(proposal.count.value, 3);
  assert.ok(countLines(counts).some(line => line.value === proposal.count.value), "the cited number is on the printed list");
  assert.match(proposal.newText, /Measured 2026-01-05: 3 of 3 judgments against "Small commits" in the last 7 days were violations, most often on `src\/a.ts`/);
  const after = applyProposals(RULES, proposals);
  const section = ruleSection(after, "Small commits")!;
  assert.match(after.slice(0, 0) + after.split("\n").slice(section.start, section.end).join("\n"), /Measured 2026-01-05/);
  assert.ok(after.includes("## Explain every command\nSay why before a command runs.\n"), "the untouched rule is byte-identical");
  const diff = formatDiff(RULES, after);
  assert.equal(diff.split("\n").filter(line => line.startsWith("+ ")).length, 2, "the blank line and the measured line are the whole diff");
  assert.equal(diff.split("\n").filter(line => line.startsWith("- ")).length, 0);
  assert.ok(after.includes("Keep each commit to one change."));
});

test("proposal cap: at most three changes are proposed however many rules fired", () => {
  const rules = Array.from({ length: 6 }, (_, index) => `## Rule ${index}\nBody ${index}.\n`).join("\n");
  const records = Array.from({ length: 6 }, (_, index) => [0, 1, 2, 3].map(nth => ruleRecord({ id: `r${index}`, name: `Rule ${index}`, at: new Date(NOW - nth * 60_000).toISOString() }))).flat();
  const counts = computeCounts({ days: 7, now: NOW, readings: [reading("a.jsonl", [])], skipped: [], ruleRecords: records, holds: [], currentRules: [] });
  const proposals = buildProposals({ counts, rulesText: rules, rules: Array.from({ length: 6 }, (_, index) => ({ id: `r${index}`, name: `Rule ${index}` })), ruleRecords: records, logPath: "/log.jsonl" });
  assert.equal(proposals.length, IMPROVE_MAX_PROPOSALS);
});

test("cited number: a proposal citing a number the pass did not print is refused, and its whole set with it", () => {
  const { counts } = supportedCounts();
  const good: ImproveProposal = {
    kind: "clarify", ruleId: "small-commits", title: "Small commits", oldText: "Keep each commit to one change.", newText: "Keep each commit to one change.",
    count: { label: "rules fired", value: 3 }, evidence: ["/log.jsonl"], why: "",
  };
  assert.equal(validateProposals([good], counts), undefined);
  const bad: ImproveProposal = { ...good, count: { label: "rules fired", value: 4177 } };
  const refusal = validateProposals([good, bad], counts);
  assert.ok(refusal, "a set with one unsupported number is refused whole");
  assert.match(refusal, /4177/);
  assert.match(refusal, /nothing was written/);
});

test("a second pass replaces the measured line instead of growing the file, and does not re-add a rule that is there", () => {
  const { counts, records } = supportedCounts();
  const rules = [{ id: "small-commits", name: "Small commits" }];
  const first = buildProposals({ counts, rulesText: RULES, rules, ruleRecords: records, logPath: "/log.jsonl" });
  const once = applyProposals(RULES, first);
  const again = buildProposals({ counts, rulesText: once, rules, ruleRecords: records, logPath: "/log.jsonl" });
  assert.equal(again.length, 1);
  assert.match(again[0]!.oldText, /^Measured 2026-01-05/, "the existing measured line is the old text");
  const twice = applyProposals(once, again);
  assert.equal(twice, once, "the same counts leave the file as it was");
  assert.equal(twice.match(/Measured 2026-01-05/g)?.length, 1);
});

test("a new rule from a repeat is added once: the same heading is not added again on the next pass", () => {
  const calls = ["src/a.ts", "src/b.ts", "src/c.ts"].flatMap(file => [1, 21, 41]
    .map(start => ({ tool: "read", input: { path: file, offset: start, limit: 20 }, cwd: CWD, failed: false, result: "" })));
  const counts = computeCounts({ days: 7, now: NOW, readings: [reading("a.jsonl", calls)], skipped: [], ruleRecords: [], holds: [], currentRules: [] });
  const first = buildProposals({ counts, rulesText: RULES, rules: [], ruleRecords: [], logPath: "/log.jsonl" });
  assert.equal(first.length, 1);
  assert.equal(first[0]!.kind, "add");
  assert.match(first[0]!.newText, /^## Read a file in one call/);
  const once = applyProposals(RULES, first);
  assert.deepEqual(buildProposals({ counts, rulesText: once, rules: [], ruleRecords: [], logPath: "/log.jsonl" }), []);
});

// ── the write ───────────────────────────────────────────────────────────────

test("write: the backup lands first and holds the old text, and the rules file gets the new text", async () => {
  const file = join(await mkdtemp(join(dir, "write-")), "pi-warden.md");
  await writeFile(file, RULES);
  const after = applyProposals(RULES, [{ kind: "add", ruleId: "new", title: "X", oldText: "", newText: "## X\nY.\n", count: { label: "repeated calls", value: 3 }, evidence: [], why: "" }]);
  const written = await writeRulesFile({ file, before: RULES, after, now: NOW });
  assert.ok(written.backup, "a backup path is returned");
  assert.match(written.backup, /\.bak-2026-01-05T00-00-00-000Z$/);
  assert.equal(await readFile(written.backup, "utf8"), RULES, "the backup holds the file as it was");
  assert.equal(await readFile(file, "utf8"), after);
  const names = await readdir(join(file, ".."));
  assert.equal(names.length, 2, "the backup sits beside the file and nothing else is written");
});

test("write: a rules file that changed since it was read is refused and stays byte-identical", async () => {
  const file = join(await mkdtemp(join(dir, "stale-")), "pi-warden.md");
  await writeFile(file, RULES);
  const after = `${RULES}\n## Added\nText.\n`;
  const written = await writeRulesFile({ file, before: "# something else\n", after, now: NOW });
  assert.ok(written.error);
  assert.match(written.error, /changed since this pass read it/);
  assert.equal(await readFile(file, "utf8"), RULES);
  const names = await readdir(join(file, ".."));
  assert.equal(names.length, 1, "no backup is left behind by a refused write");
});

test("write: a missing rules file is an error, not an empty file", async () => {
  const file = join(await mkdtemp(join(dir, "missing-")), "pi-warden.md");
  const written = await writeRulesFile({ file, before: "", after: RULES, now: NOW });
  assert.ok(written.error);
  await assert.rejects(readFile(file, "utf8"));
});

// ── the quiet window ────────────────────────────────────────────────────────

test("quiet: a window armed by one session is dead for another session and dead after its expiry", () => {
  const quiet = new QuietWindow();
  const armed = quiet.arm("session-a", 60_000, NOW);
  assert.equal(quiet.active("session-a", NOW + 1000), true);
  assert.equal(quiet.active("session-b", NOW + 1000), false, "another session keeps judging");
  assert.equal(quiet.active(undefined, NOW + 1000), false);
  assert.equal(quiet.statusLine("session-b", NOW + 1000), undefined, "another session does not see the window");
  assert.ok(quiet.statusLine("session-a", NOW + 1000));
  assert.equal(quiet.active("session-a", armed.until), false, "the window is ignored at its expiry");
  assert.equal(quiet.statusLine("session-a", armed.until + 1), undefined);
});

test("quiet: the window is capped at fifteen minutes, and a zero setting arms nothing", () => {
  const quiet = new QuietWindow();
  assert.equal(quiet.arm("s", 60_000_000, NOW).ms, QUIET_MAX_MS);
  assert.equal(quiet.active("s", NOW + QUIET_MAX_MS + 1), false);
  const off = quiet.arm("s", 0, NOW);
  assert.equal(off.ms, 0);
  assert.equal(quiet.active("s", NOW + 1), false, "improve.quietMs 0 leaves the rules judge on");
});

test("quiet: a disarm leaves no window behind, so a second /warden improve is not refused", () => {
  const quiet = new QuietWindow();
  quiet.arm("session-a", 600_000, NOW);
  assert.ok(quiet.statusLine("session-a", NOW));
  quiet.disarm();
  assert.equal(quiet.statusLine("session-a", NOW), undefined);
  assert.equal(quiet.active("session-a", NOW), false);
});
