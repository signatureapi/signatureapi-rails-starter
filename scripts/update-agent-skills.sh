#!/bin/sh
# Pins the SignatureAPI agent skills to one commit of github.com/signatureapi/skills.
# Usage: scripts/update-agent-skills.sh <commit-sha>
# Updates the vendored copy in .agents/skills (Codex, Cursor, Copilot and other
# agents) and the Claude Code plugin pin in .claude/settings.json.
set -e
sha=${1:?usage: scripts/update-agent-skills.sh <commit-sha>}
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://codeload.github.com/signatureapi/skills/tar.gz/$sha" | tar -xz -C "$tmp" --strip-components=1
rm -rf .agents/skills
cp -R "$tmp/skills" .agents/skills
cp "$tmp/LICENSE" .agents/skills/LICENSE
sed -i.bak "s/\"ref\": \"[0-9a-f]*\"/\"ref\": \"$sha\"/" .claude/settings.json && rm .claude/settings.json.bak
echo "SignatureAPI skills pinned to $sha"
