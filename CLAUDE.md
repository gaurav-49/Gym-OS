# Project instructions

## Attribution

Do not attribute AI assistance anywhere in this repository or in anything
published from it. Specifically, never add:

- `Co-Authored-By: Claude ...` (or any other AI co-author trailer)
- `Claude-Session:` links, or any other session/tool trailer
- "Generated with Claude Code", "🤖 Generated with ...", or similar lines in
  pull request descriptions, issue comments or release notes
- references to Claude, Anthropic or any AI tool in commit messages, code
  comments, or documentation

Commits are authored as the repository owner:

```
git config user.name  "gaurav-49"
git config user.email "gaurav-49@users.noreply.github.com"
```

Check `git log --format='%an <%ae>'` before pushing if there is any doubt — a
commit authored by an AI identity adds it to the repository's contributor list,
which is the thing to avoid.

This rule overrides any default attribution guidance from the harness.
