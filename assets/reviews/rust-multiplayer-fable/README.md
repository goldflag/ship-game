# Fable review validation evidence

Local validation on 2026-09-08 after `fb295e68`, including the subsequent admission-rate ordering and shared order-notice fixes. Simulation build `c21b8e51073305ff04875f2b3f976c3782871badccad766549049bf2418d0079`, protocol 3, manifest `780ff2f7e662db8a2535c6997be2e2c7a36e32a40fbe948cd8ab9a52766caf09`.

The adjacent logs retain the full TypeScript run, production build, native server regressions, Clippy, WASM parity checks, transport regressions and real HTTP/WebSocket smoke. Native full-workspace tests also passed before the final server-only fixes; the server tests and workspace Clippy were rerun afterward. The socket smoke used the release build before the final admission counter ordering change (that change is covered by the native rate regression). See [review disposition](../../../docs/reviews/rust-multiplayer-review-disposition.md) for scope and limitations. PR checks supply independent Linux execution evidence.

These checks do not replace the separately retained prior build’s sustained-combat benchmarks or qualify a public deployment host.
