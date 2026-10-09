---
name: signatureapi-docs
description: "Use when a question about SignatureAPI needs a documented answer: how a feature works, what the API accepts, webhook behavior, signing flows, limits, or why something happened. Use it even when you think you know the answer, and even when the user knows no SignatureAPI terms. Not for other vendors' docs."
allowed-tools: WebFetch(domain:signatureapi.com)
---

# Research the SignatureAPI docs

## Purpose

Answer SignatureAPI questions from the current published docs. Link a page
for every claim. Find pages by meaning, not by keyword. Read each page live
and in full. Keep no copy between questions.

## When to reach for something else

- **Field names, types and allowed values** come from the OpenAPI spec.
  Query it with the `openapi-explore.mjs` script bundled with
  `signatureapi-integrate`. Without a shell, read
  `https://spec.signatureapi.com/openapi.yaml`.
- **Deciding how an app should use SignatureAPI** belongs to
  `signatureapi-architecture`.
- **Writing code that calls SignatureAPI** belongs to
  `signatureapi-integrate`.
- **An envelope that misbehaves** belongs to `signatureapi-diagnose`. This
  skill explains documented behavior. It does not read account state.
- **Another vendor's product** needs that vendor's own docs.

## Keep the user's vocabulary

Answer in the user's words. Map each of their concepts to a SignatureAPI
term only to choose pages. Name a SignatureAPI term only for an API field,
an event, or a page title.

## Sources, in order

1. Docs pages found through the docs index,
   `https://signatureapi.com/llms.txt`. Fetch each page as page Markdown.
2. `search_documentation` on the SignatureAPI MCP server. Use it only for
   an exact string: an error message, an event name, a field name. Its
   index can lag the live pages. With `page` set to a page path from the
   docs index, it returns that page in full. Use this when you cannot fetch
   URLs.
3. A web search limited to `site:signatureapi.com`.

Memory is not a source. Do not state a fact you did not read in this
session, even when you are sure of it.

## Find the pages

1. List the concepts the question needs, in the user's words.
2. Fetch the docs index at `https://signatureapi.com/llms.txt`. Never guess
   a docs URL.
3. Pick one to three pages whose titles or descriptions cover those
   concepts. Choose by meaning. The user's words often differ from the
   page's words.
4. Fetch each page as page Markdown. Read the whole page, not an excerpt.
   Some fetch tools return a summary instead of the page. With a shell,
   save the raw text with `curl -s -o <file> <page URL>.md`. Put the file
   in a temporary directory, never in the user's project. Read the file in
   full, in parts if the host limits output. Do not search it for
   keywords. Otherwise ask the fetch tool for the full text verbatim. Read
   the docs index the same way.
5. Follow links in the page that bear on the question. Fetch them the same
   way.
6. Check each claim you plan to make against the text you read.

If a claim is still open, change the angle and repeat steps 3 to 6:

- Try a related concept, or the parent or child page.
- Look up an exact string with `search_documentation`. Use two to six
  title-like words, never the whole question.
- Search the web with `site:signatureapi.com`.

Stop after three rounds. Stop sooner once every claim has a page.

## Answer

- Link the page for every documented claim.
- Mark anything you worked out, rather than read, as your inference.
- When two pages disagree, say so and link both.
- When the docs do not cover the question, say so. Point to the OpenAPI
  spec or to SignatureAPI support. Do not fill the gap from memory.
- When you cannot fetch pages, say the answer is unverified. Name the page
  the user should check.
- Ask the user a question only when the answer changes which page applies.

## Vocabulary

- **Docs index**: `https://signatureapi.com/llms.txt`. It lists every
  published docs page with a one-line description.
- **Page Markdown**: a docs page as Markdown, at the page URL plus `.md`.
- **OpenAPI spec**: `https://spec.signatureapi.com/openapi.yaml`. It is the
  source of truth for field names, enum values, events, paths and limits.
