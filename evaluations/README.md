# Evaluations

Ten read-only questions that check whether the tools of this server are sufficient to answer realistic
questions about an Enhancv account, using the format of the MCP builder evaluation guide
(`<qa_pair>` with one verifiable answer each).

| File | Purpose |
|---|---|
| `questions.xml` | The ten questions and their exact answers. |
| `fixtures.ts` | A fictional Enhancv account with twelve synthetic resumes (no real people, `example.com` addresses). |
| `../test/helpers/mock-enhancv.ts` | In-process mock of the Enhancv API (documented behaviour: cursor pagination, error bodies, PDF export). |
| `../test/evaluations.test.ts` | Reference solutions: every question is solved with real MCP tool calls against the mock and compared with the expected answer. |

## What is verified

`pnpm test` runs `test/evaluations.test.ts` and fails if

- `questions.xml` is malformed, does not contain exactly ten pairs, or an answer is empty or not a single line,
- a question has no reference solution or the solution produces a different answer,
- a solution needs fewer than two tool calls (the questions must require exploration), or
- any solution sends something other than `GET` requests to the API (the questions must stay read-only and non-destructive).

The questions use closed, fixed data, so the answers never change. They avoid keyword-only lookups: most need the
resume list plus the content of several resumes, ordering semantics (oldest first by ID), the 0-based months of the
Enhancv date format or the PDF export.

## What is not verified

The test proves the questions are answerable with these tools and that the answers are correct. It does not measure
whether a language model picks the right tools on its own. To measure that, run an LLM agent against the mock
(`pnpm mock:api`, then start the server with `ENHANCV_API_URL` pointing at it) and compare its answers with
`questions.xml`, for example with the evaluation harness of the MCP builder skill.

## Adding a question

1. Extend `fixtures.ts` only with synthetic data and make sure the new answer is unique.
2. Add the pair to `questions.xml` and a solver with the same number in `test/evaluations.test.ts`.
3. Keep it read-only, independent of the other questions and based on data that cannot change.
