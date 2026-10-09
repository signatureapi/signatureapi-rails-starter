# Design

Both apps follow signatureapi.com's visual style.

## Colors

| Token | Hex | Use |
|---|---|---|
| Text | `#18181B` | Primary text, primary buttons |
| Text secondary | `#3F3F46` | Body copy |
| Text tertiary | `#686870` | Captions |
| Border | `#E0E3E9` | Card outlines |
| Background | `#F9F9F9` | Screen background |
| Accent | `#2563EB` | Links, focus |

Result screens add semantic colors: success `#15803D`, danger `#B91C1C`, warning `#B45309`, each on a pale tint.

Cards and buttons use a 10-point corner radius.

## Fonts

[`fonts/`](fonts/) is the single copy both apps use: the iOS project references the folder directly, and a Gradle task copies it into Android resources.

| File | Use | License |
|---|---|---|
| `SignatureAPITitle-Medium.ttf` | Titles | SIL Open Font License 1.1 ([`SignatureAPITitle-LICENSE.txt`](fonts/SignatureAPITitle-LICENSE.txt)), based on Hubot Sans |
| `Inter-Regular.ttf`, `Inter-Medium.ttf`, `Inter-SemiBold.ttf` | Everything else | SIL Open Font License 1.1 ([`Inter-LICENSE.txt`](fonts/Inter-LICENSE.txt)) |
