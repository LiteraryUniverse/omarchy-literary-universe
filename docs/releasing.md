# Release checklist

1. Confirm the LU companion API, OAuth discovery, consent, refresh and revocation work on production.
2. Run `tests/run` and `omarchy plugin validate .`.
3. In Omarchy, test a real login, capture visible in the web scratchpad, task add/complete, latest writing destination and cover, diary reminder and snooze, unread notification/read state, and the official blog link. Test reconnect, expired/revoked tokens, two monitors, theme change and an RTL locale.
4. Run `demo/run` to retake `preview.png` with fictional content if the panel changed. Update `CHANGELOG.md` and the manifest version, merge, then tag the reviewed commit on `main` with an annotated `vX.Y.Z` tag and publish its release notes. No step here automatically publishes or merges anything.
5. Submit with the marketplace issue form at https://github.com/omacom/omarchy-plugin-marketplace (title `[Plugin]: Literary Universe`), category **Productivity**, tags **Bar** and **Quickshell**, suggested tag **Writing**. Fix findings in this repository and edit the same issue; never open a duplicate.
6. After the registry accepts the listing, record its URL in this README and on the LU integration page. Never claim marketplace availability before that.

The registry validates listings, not plugin security. Review every dependency or
network-source change. The helper has no npm runtime dependencies.
