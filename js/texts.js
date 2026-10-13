// Longer fixed texts.

export const DATA_README = `<!-- learning-tester:data-readme v2 -->
# Learning Tester data

This private repository holds the data for Learning Tester, a personal
spaced-repetition app. The app reads and writes these files; you can also read
them yourself, or give them to any AI or tool. Everything is plain text.

## Files

| Path | What it holds |
|---|---|
| \`themes.json\` | Themes, e.g. "Spanish", and sub-themes, e.g. "Verbs" (a sub-theme has \`parent\`: its theme's id). |
| \`settings.json\` | Scheduling settings (desired retention, daily limits, ...). |
| \`cards/<theme>.json\`, \`cards/<theme>/<sub-theme>.json\` | The cards in each theme and sub-theme. \`cards/_deleted.json\` lists permanently deleted cards so they don't come back from another device. |
| \`library/<theme>/[<sub-theme>/]<entry>.md\` | Library entries: what you learnt, in your own words, with sources. |
| \`reviews/<device>/<YYYY-MM>.jsonl\` | Review history, one JSON object per line. Each device writes only its own files. |
| \`coach/INSTRUCTIONS.md\` | Instructions for an AI learning coach (paste into a claude.ai Project, ChatGPT, etc.). |

## A card

\`\`\`json
{
  "id": "c_9h2m1",
  "theme": "t_k3j9x2",
  "entry": null,
  "type": "concept",
  "prompts": ["What is an API?", "In plain words, what does an API let one program do?"],
  "answer": "Ask another program for data or actions, following agreed rules.",
  "accept": [],
  "builds_on": [],
  "author": "me",
  "source": "",
  "unverified": false,
  "tags": [],
  "status": "active",
  "created": "2026-10-09T10:00:00.000Z",
  "updated": "2026-10-09T10:00:00.000Z"
}
\`\`\`

- \`type\`: \`concept\` (you mark yourself) or \`exact\` (typed answer marked automatically; \`accept\` lists other accepted answers).
- \`prompts\`: alternative wordings of the same question. They share one schedule.
- \`builds_on\`: ids of simpler cards this one builds on.
- \`author\`: \`me\` or \`claude\` (a suggestion you approved).
- \`status\`: \`active\` or \`archived\` (archived cards are kept but not reviewed).

## A review (one line in a .jsonl file)

\`\`\`json
{"id":"iphone-ab12-...","card":"c_9h2m1","ts":"2026-10-09T10:05:00.000Z","rating":3,"kind":"review","ms":8400,"prompt":0,"device":"iphone-ab12"}
\`\`\`

- \`rating\`: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy.
- \`kind\`: \`review\`, or \`followup\` for a related-word check (only a wrong follow-up affects the schedule).
- \`ms\`: time taken. \`prompt\`: which wording was shown.

## Schedules

Schedules are not stored. They are worked out by replaying each card's reviews
through the FSRS algorithm (the open-source ts-fsrs library, as used by Anki),
with the settings in \`settings.json\`. Any FSRS implementation can rebuild them.
`;
