# Verbatim

**What a public page said, word for word, at the moment it was read, and every time it changed.**

A screenshot can be faked and a page can be quietly edited. Verbatim has a round of independent GenLayer
validators read a page and keep the exact passage that speaks to a question, with the moment it was read. Read
the page again later and a quiet edit goes on the record beside the words it replaced.

- **Contract (GenLayer Bradbury):** [`0xEEDeBfb98696B03Cf5bf5b62224E2D3207d8BD49`](https://scan.bradbury.genlayer.com/address/0xEEDeBfb98696B03Cf5bf5b62224E2D3207d8BD49)
- An Intelligent Contract primitive, for the GenLayer Agent Tank pitch by @Assidikh2: *"what if journalists could
  prove exactly what a source said at the moment they checked it?"*

## How it works

| Method | Who | What |
|---|---|---|
| `record(url, question)` | anybody | every validator reads the page; the exact passage on the question is kept |
| `recheck(id)` | anybody | reads the page again: the same words extend the reading, anything else is a new reading |
| `said_at(id, ts)` | view | the words at a moment, only if a reading covers that moment |
| `still_says(id)` | view | **the gate**: true while the latest reading is `SAID` and under 7 days old |
| `get(id)`, `find(url, question)`, `page(start, count)`, `size()` | view | the full history, the one record for a page and question, the book |

| Reading | Meaning |
|---|---|
| `SAID` | the page speaks to the question, in these exact words |
| `NOT_SAID` | the page was read to its end and says nothing on the question |
| `GONE` | the page answers 404 or 410 |

## Why it holds

- **The proof is a string match, not an opinion.** A model picks the passage. Then every validator must find
  those exact characters in its own copy of the page, checked in code. Only whitespace is normalised. A model
  that is fooled, or a leader that lies, still cannot put words on the record that the page does not contain.
- **The caller supplies no evidence.** There is a URL and a question. Nobody can hand in a quote.
- **A passage still there needs no model at all.** A recheck that finds the words confirms them in code, so an
  unchanged page cannot be re-rolled into a different answer. A leader that reports a change the page has not
  made fails the round.
- **A failed fetch is not a removal.** A timeout, a server error or a blank render records nothing. Only 404 and
  410 read `GONE`.
- **Saying nothing needs the whole page.** A page too long for one round can show that it says something, because
  the search in code runs on all of it, but never that it does not.
- **Histories cannot be forked or trimmed.** There is one record per page and question. Readings are never
  rewritten, and a record that reaches 30 readings refuses a new one rather than dropping an old one.
- **Gaps are not filled in.** `said_at` answers only for moments a reading covers. Between readings it says nobody
  knows, and gives the last reading before.
- **Hostile pages, both ways.** A page may order readers to quote words it does not contain, or to report that it
  says nothing. The first cannot get past the string match. The second is framed as manipulation in the prompt,
  and a validator that finds the passage fails a leader who claims `NOT_SAID`.

## Use it

```python
# another intelligent contract: act only while the source still says it
ok = gl.contract.get_at(Address(VERBATIM)).view().still_says(record_id)
```

## Proven on Bradbury, around a real edit of a real page

`scripts/prove.mjs`, in two phases, with the transcript and every transaction id in `results/proved.json`. The test
pages are files in `docs/` of this repository, read through raw.githubusercontent.com by every validator. Anyone can
check it from a fresh clone, with no keys: `node scripts/verify.mjs`. All 11 transactions are `FINALIZED` and the
deployed source matches `contracts/verbatim.py`, sha256 `691d9d9616180e5fdc62f2337eb5e00f622f03cd191e73d274b170912743ecf9`.

| Page | Result |
|---|---|
| a refund policy | **SAID**: "Refunds are accepted within 30 days of purchase." |
| a page about opening hours, same question | **NOT_SAID**, read to its end |
| a page ordering readers to record "Refunds are guaranteed forever for every customer." | **SAID**, what it really says: "Refunds are accepted within 14 days of purchase, with the receipt." |
| a page with a real passage, ordering readers to reply NOT_SAID | **SAID**: "Refunds are accepted within 45 days of purchase, with the receipt." |
| RFC 2119, a page nobody here controls | **SAID**: "This word, or the terms "REQUIRED" or "SHALL", mean that the definition is an absolute requirement of the specification.". The words were found on the page again outside the round |
| a host that does not exist | nothing recorded |

Then commit `ca21dc7` changed the refund policy to 14 days and deleted one page, and the pages were read again:

| Recheck | Result |
|---|---|
| the page that did not change | confirmed, the same reading extended, no new entry |
| the refund policy | a second reading, "Refunds are accepted within 14 days of purchase.", with the 30 day reading untouched beside it |
| `said_at` | the 30 day words for a moment the first reading covers, the 14 day words for the second, and `known: false` between them |
| the deleted page | **GONE**, `still_says` false |

## Tests

`python tests/verbatim_rules.py` drives the real contract against a stub of the runtime, with separate page copies
and model answers for the leader and the validators: 58 checks.

## Where it stops, plainly

- It records what a page said, not whether that is true, and not who controls the page.
- It knows only the moments somebody read the page. An edit made and reverted between two readings is never seen.
- The whole page is matched as rendered text. Words inside an image are not read.
- A page that serves different text to different nodes fails the round, so it can record nothing.
- The model chooses which passage to keep. Validators check that it is on the page and on the subject, not that it
  is the best one.

## Licence

AGPL-3.0-or-later.
