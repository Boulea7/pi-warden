# Field usage, 2026-09-16 to 2026-10-26

What pi-warden did during forty-one days of the maintainer's own work across all their projects: several coding agents running in parallel in a handful of repositories, this one included. The data is not a benchmark. It is everything pi-warden logged while it was used for real. It replaces the [2026-10-01 report](../2026-10-01-field-usage/README.md) as the source of the README numbers, over the same start date and with the same script and definitions.

- Produced by: `node scripts/field-usage.mjs --since 2026-09-16T00:00:00+08:00 --until 2026-10-27T00:00:00+08:00 --json`, run on 2026-10-27 (17 seconds for 3,350 session logs).
- Raw numbers: [`usage.json`](usage.json). Aggregate counts only: no session text, paths, project names, or rule names (the rules come from private projects, so each rule is a count).
- pi-warden versions: whatever was installed as each release landed, from before 0.56 to 2.2.2.

## Totals

| | |
| --- | --- |
| Sessions | 3,350 |
| `bash` calls | 211,116 |
| Actions judged by the action guard | 184,249 |
| Held before running | 817 (0.4%) |
| Steers sent to the agent | 3,024 |
| Oversized tool outputs replaced by an excerpt | 828 |

## What worked

**The done-check changes behaviour.** It nudged 255 times when an agent said it was done with no passing test, build, or lint behind the claim. In 182 of those (71%), the agent's next few calls ran a check. The share is lower after the last report: from 2026-10-02 on it was 88 of 131 (67%).

**Holds were cheap and usually right about the action.** 817 of 184,249 judged actions were held. Of the 276 holds with a known outcome, the agent took a safer route 235 times, the user approved 30, and declined 11. The held actions included 25 `git reset --hard` and 14 force pushes. From 2026-10-02 on, the user approved 1 of 160 holds with a known outcome.

**The rules guard catches what no linter checks.** 598 steers named a project rule, spread over 48 rules. This is a lower bound: 13 more rules-guard steers use the newer "breaks a project rule" wording, which the script counts as "other" (see Steer classes).

## What was noise

**Deleting its own scratch.** 632 of the 817 holds (77%) were recursive deletes of an absolute or temp path, mostly agents cleaning up scratch they had just made. In the last seven days the share was 97 of 115 (84%). The scratch-precision changes (0.82.0 and later) have not brought the share down.

**Credential notices on code.** 400 notices, all of them before 2026-09-25. None were sent from 2026-09-25 to 2026-10-26. Later changes (0.83.0) also keep masking away from code values such as a call or a variable name.

**The conscience named core tools only in the first window.** 404 recommendations: 146 named a core tool (`read`, `bash`, `search_code`), 53 named another tool, and 205 named a skill. All 146 core-tool recommendations came before 2026-10-02; after that, 25 named another tool and 99 a skill.

## Steer classes

`scripts/field-usage.mjs` sorts each steer by its text. 137 of the 3,024 steers (4.5%) fall into "other"; in the last seven days it was 22 of 186 (11.8%), because the classifier does not know messages added since the 2026-10-01 report. A separate pass over the same logs sorts those 137: 107 cause-check steers (the final reply states a cause nothing in the run checked), 13 rules-guard steers in the "breaks a project rule" wording, 10 repeated-call notes, 5 cause-check steers for a reply that asks a person to check something, and 2 tool suggestions. The script is unchanged, so every class below has the 2026-10-01 definition.

| Class | Steers, 2026-09-16 to 2026-10-26 |
| --- | --- |
| rules | 598 |
| credential notice | 400 |
| intent mismatch | 397 |
| open loops | 395 |
| slop | 341 |
| done-check | 255 |
| stuck | 242 |
| other | 137 |
| security | 83 |
| needs user input | 59 |
| prose trend | 27 |
| tool or skill reminder | 25 |
| off-task | 25 |
| prompt injection | 14 |
| repeat note | 9 |
| subagent report | 8 |
| action warning | 6 |
| runaway | 3 |

Intent-mismatch and off-task notices appear here as steers only while a version sent them to the agent; from 0.76.0 the intent steer is trace-only by default, and the off-task notice is trace-only as well. No steer of either class was sent after 2026-10-01.

## Method and limits

- Session logs and the local holds database, read by `scripts/field-usage.mjs`. The script also runs on your own logs.
- A session counts when its log file was last written inside the window. A session still being written after 2026-10-27 00:00 (+08:00) is left out, with all its earlier events.
- "Followed by a check" means one of the agent's next four messages ran a verification command. It does not prove the nudge caused the check.
- A hold has a known outcome when it is labelled approved, declined, or replanned. 541 of the 817 holds have none: 504 have no recorded outcome, and 37 are labelled abandoned (the run ended with the hold neither released nor worked around), which pi-warden itself counts as unknown.
- All ratios are counts, not labels.
- The 2026-10-01 report does not fully reproduce. Run today over its window, the script reads 1,220 sessions, 430 holds, and 424 rules steers, against its 1,168, 419, and 422; its done-check (124 nudges, 94 checks) and hold outcomes (79, 29, 3) reproduce. That report was committed at 11:40 on its last day, before its window closed, so later sessions of that day are missing from it. This report counts the whole span again instead of adding to its totals.
- Carried over from the 2026-10-01 report and not re-derived here: who ran the sessions and where, the lower version bound ("before 0.56"), "mostly agents cleaning up scratch", and the 0.76.0 and 0.83.0 version notes.
- One maintainer, one machine, forty-one days of fast-changing versions. Read it as field evidence, not as a benchmark.
- To refresh: run the same command with `--until` moved to the midnight (+08:00) after the last complete day, and keep `--since` unchanged.
