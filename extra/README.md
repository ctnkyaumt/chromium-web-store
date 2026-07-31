# extra/

Extensions this fork self-hosts, for cases where no store serves a working
update: an unpublished CWS listing, or a repack whose `update_url` points
nowhere. Each one is offered in `CURATED_EXTENSIONS` (`src/scripts/util.js`)
with an `updateUrl` pointing at its manifest under `dist/`.

| file | role |
| --- | --- |
| `<name>.crx` | the source drop — replace this to publish a new build |
| `extensions.json` | maps each `<name>` to the secret holding its signing key |
| `dist/<name>.crx` | generated: re-signed under our key, `update_url` rewritten |
| `dist/<name>.updates.xml` | generated: the omaha manifest clients poll |
| `dist/<name>.state.json` | generated: last published version + source hash |

Everything in `dist/` is written by `.github/workflows/extra.yml` on any push
that touches `extra/*.crx`. Do not hand-edit it.

## Publishing a new build

1. Replace `extra/<name>.crx` and push to `master`.
2. The workflow re-signs it and commits `extra/dist`.

The version comes from the crx's own manifest. If the bytes change but the
version does not, the 4th component is incremented so clients still see an
update.

## Adding an extension

Each extension needs **its own** signing key — the extension id is derived from
the key, so two crx files signed with the same one collide on the same id.

1. `openssl genrsa 2048 > key.pem`
2. `python .github/scripts/crx_tools.py id --key key.pem` — this is the id.
3. Store the key as a repo secret, then list that secret in `extra/extensions.json`
   **and** in the `env:` block of `.github/workflows/extra.yml`.
4. Drop the crx at `extra/<name>.crx`.
5. Add the entry to `CURATED_EXTENSIONS` with the id and
   `https://raw.githubusercontent.com/<repo>/master/extra/dist/<name>.updates.xml`.

Losing a key means losing the ability to update that extension: a new key
yields a new id, which clients see as a different extension.

## Sources

- `sah` — third party, no source here. Neither upstream works: the XPI repack
  ships a placeholder `update_url` of `https://example.com/updates.xml`, and CWS
  listing `eilpnlhignocnlfognmnogdjdcpnolbd` is unpublished.
- `match-alarm` — ours. Source in `extra/src/match-alarm/`. Note the workflow
  repacks `match-alarm.crx`; it does not build from that directory, so rebuild
  with `crx_tools.py pack --src extra/src/match-alarm` when the source changes.
