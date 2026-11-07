# Release checklist

1. Merge and deploy the LU companion API and translated integrations listing after review. Verify OAuth discovery, consent, refresh and revocation on that deployment.
2. Run `npm test`, `npm run check`, and `omarchy plugin validate .`.
3. In Omarchy, test a real login, capture visible in the web scratchpad, task add/complete, latest writing destination, diary reminder and snooze, unread notification/read state, and the official blog link. Test reconnect, expired/revoked tokens, two monitors, theme change and an RTL locale.
4. Update the screenshot with fictional content. Merge the implementation PR, then tag a reviewed version and publish its release notes. No step here automatically publishes or merges anything.
5. Submit the public repository at https://plugins.omarchy.org/publish.html. The registry requires a valid root manifest, README, license, and safe installation/removal. Choose the productivity category and writing, notes, tasks tags. Record the accepted listing URL in the README and LU integration page.
6. Keep the LU listing marked early access until real deployment checks pass. Never claim marketplace availability before the registry accepts it.

The registry validates listings, not plugin security. Review every dependency or
network-source change. The helper has no npm runtime dependencies.
