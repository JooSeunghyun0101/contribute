# AI Configuration

The production deployment should use the internal local LLM. Do not hardcode API keys or service credentials in source files.

## Local Environment

Create a local `.env` from `.env.example` and fill values only on the target machine.

```env
VITE_GEMINI_API_KEY=
VITE_OPENAI_API_KEY=
```

These client-side variables are legacy placeholders. Prefer routing AI calls through backend endpoints such as `/api/ai/...` before production use.

## Rules

- Never commit real API keys, tokens, passwords, or internal hostnames.
- Keep `.env` local and ignored by Git.
- Use `.env.example` for placeholder names only.
- Rotate any key that was previously committed or shared.
