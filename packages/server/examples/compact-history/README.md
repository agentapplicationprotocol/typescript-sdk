# compact-history example

An AAP agent backed by the Vercel AI SDK with sliding-window history compaction. Only the last 10 messages are sent to the model per turn; the full uncompacted history is still retained and available via `GET /session/:id`.

## Running

```bash
npm run example:compact-history
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
