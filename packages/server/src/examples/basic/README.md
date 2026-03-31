# basic example

A minimal AAP agent backed by the Vercel AI SDK. Full conversation history is retained for the lifetime of the session — no compaction.

## Running

```bash
npm run example:basic
```

The server starts on port `3010` by default. Set `PORT` to override.

## Configuration

Options are passed per-session by the client:

| Option    | Description                | Default    |
| --------- | -------------------------- | ---------- |
| `baseURL` | OpenAI-compatible base URL | _(openai)_ |
| `apiKey`  | API key                    | _(empty)_  |
| `model`   | Model ID                   | `gpt-4o`   |

## Tools

- `web_fetch` — fetches and strips HTML from a URL (truncated to 8000 chars)
