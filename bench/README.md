# derja-bench

The quality instrument. `npm run exam` is the contract and must stay green; this is the number that
must go up. Designed in `design-benchmark.md`, cut to v1 by BUILD-PLAN decisions D18, D19 and D20:
**40 cases, deterministic scoring only, no judge model.**

```
npm run bench -- run --tag smoke --repeats 1 --only clim-express --dry-run   free, no API call
npm run bench -- run --tag baseline-lite --repeats 3                          calls OpenAI
npm run bench -- compare baseline-lite after-voice-rewrite                    exit 1 on WORSE
npm run bench -- review baseline-lite
npm run bench -- lexicon baseline-lite
node tools/bench-checks.js self-test                                          free, the checks' own test
```

## What is here

| path | what |
|---|---|
| `cases/*.json` | the 40 frozen cases. `"version": 1`. Never edited in place — a change is version 2 and a new baseline. |
| `ceiling.json` | B2: 15 conversations answered only with lines the owner already approved. They must score 9. |
| `runs/<tag>/` | `run.json` `answers.jsonl` `checks.jsonl` `scores.json` `unknown.tsv` `review.md` |

**Read `review.md`, not `scores.json`.** The numbers are for the decision; the quoted answers are so
the owner can read the Derja and disagree.

## The two numbers that matter most

- **DerjaScore (raw) vs DerjaScore (sent)** — the gap is exactly how much work `lib/derja.js` is doing.
  If prompt work only moves `sent`, it is hiding behind the swap list instead of improving the model.
- **Rewrites per 100 answers** — every rewrite is an answer the model got wrong first try, at the cost
  of a second full prompt. It needs no grader and it is the cheapest signal that a prompt got better.

## The spread (design-benchmark §1.1, scaled to 40)

| file | cases | answerable | thin | flow | messy | trap |
|---|---|---|---|---|---|---|
| `clim-express.json` | 10 | 3 | 3 | 2 | 1 | 1 |
| `yasmine-photo.json` | 10 | 3 | 3 | 2 | 1 | 1 |
| `patisserie-nour.json` | 10 | 3 | 3 | 2 | 1 | 1 |
| `digiplus.json` | 5 | 2 | 1 | — | 1 | 1 |
| `general.json` | 5 | — | — | — | 3 | 2 |

Every case carries `"knows": yes | partial | no`, taken from the verdict column of `spec-demos.md`.
Without it the grader cannot tell an honest "I don't know" (good) from an evasion of a fact written
three lines above in the brain file (bad).

The client side may write anything — Moroccan, Levantine, Arabic script, one word, typos. **Nothing in
`must` / `mustAny` / `never` uses a word that is not already in `brain/*.md` or `data/*.json`.**

## What v1 does not do

- **No judge model** (D20). NAT — naturalness, 25 of the 100 weight points — is the one dimension no
  code can see, so it reads `—` and DerjaScore is the weighted mean of the other 75 points.
- **No invented-word detector** (D08 / gate G3). It needs `data/lexicon.json`, which is WI-2.4. G3
  reads `—`, never `0`. `unknown.tsv` is written anyway, as an unfiltered token census, so the review
  habit starts on run one.
- **It does not grade line length.** The library says "short lines" and gives no number
  (`spec-language.md` §7.2 is `[LIBRARY SILENT]`). The distribution is reported, nobody scores it
  until the owner sets a number, and that number is a product decision, not a language rule.
- **It does not police Arabizi typography** (« », …, the space before `?`). `11 §4` covers Arabic
  script only. The price forms (`~`, `30dt/mois`, `3,500 DT`) are certain and are checked; the rest
  waits for a native ruling.

## Three deliberate departures from design-benchmark §3.3

Each one exists because the ceiling is the owner's own approved text, and a check that marks his own
lines down is a wrong check, not a wrong answer.

1. **D18 accepts 🙏** as well as 😊 and 👌 (BUILD-PLAN D10). The library says two emoji; the brain
   files use 🙏 eighteen times, including in `@unknown` and the `FALLBACK`. Owner question O11.
2. **D12 is measured over the whole answer**, not per message. `@price` in `brain/digiplus.md`
   deliberately splits «t5alles fel chhar» and what each formule includes into two messages.
3. **`must` / `never` / `card` are matched over the whole conversation**, not only the last answer.
   §1.4's own `yasm-c02` carries `must: ["200dt"]` on a four-turn booking whose whole point is that the
   price is said once and never repeated. For the 27 single-turn cases the two readings are identical.

## The checks' own test

`node tools/bench-checks.js self-test` runs both halves, and both must pass:

- **the ceiling** — the 15 conversations of `ceiling.json` must score at or near 9 on every dimension.
  If they do not, *the checks are wrong, not the answers.* It also prints every line of `ceiling.json`
  that is not an approved line word for word, so it is visible that no agent wrote Tunisian.
- **the probes** — 25 known-bad lines, each quoted from the audit, from `spec-language.md` or from the
  design document, each paired with the check that must catch it. A ceiling of 9 also happens when
  every check is dead; this is the half that proves they are not.
