# Literary Universe for Omarchy

Capture ideas, manage personal tasks and return to your writing from the Omarchy bar.

**Early access.** This first version requires LU's `/api/companion/v1` backend changes.
It is not yet listed in the Omarchy marketplace. The implementation is on the
`feat/companion` branch until its pull request is reviewed and merged.

![The companion panel with example writing data](docs/panel.png)

## Features

- **Scratchpad:** read your latest notes and append a quick capture without replacing existing rich formatting. Draft capture text saves locally as you type. Interrupted submissions retain their operation ID for safe retry.
- **Diary:** open today's entry and receive an optional daily desktop reminder using your LU reminder timezone and hour. Snooze for 30 minutes. Completed days are not reminded.
- **Todos:** add and complete personal tasks using LU's task permissions and subscription rules. The panel shows up to 100 unfinished tasks, ordered by due date.
- **Continue writing:** return to the last story or universe in your LU writing history, using the same destination as your dashboard.
- **Notifications:** see up to 20 unread Novu notifications, open their destinations and mark them read. Optional message and release banners respect desktop Do Not Disturb. `20+` means more unread notifications are available on the website.
- **LU blog:** show the latest published article from LU's configured official blog.

## Installation

Requires Omarchy Quattro with `qs.Commons.Translations`, Node.js 22 or later,
`util-linux` (`flock`), `libsecret` (`secret-tool`), a running Secret Service,
`xdg-utils` and `libnotify`. No npm packages or build step are needed.

Once the implementation PR is merged:

```sh
omarchy plugin add https://github.com/LiteraryUniverse/omarchy-literary-universe.git
omarchy plugin enable literaryuniverse.companion
```

During review, clone the implementation branch into a separate directory, review
it, then copy that directory to `~/.config/omarchy/plugins/literaryuniverse.companion`.
Run `omarchy plugin validate` on the directory, rescan with
`omarchy-shell shell rescanPlugins`, and enable it. Do not overwrite an existing
installation or unsynced local data.

Click the book icon and choose **Log in**. Your browser opens LU's OAuth consent
page. The plugin never asks for your LU password. Authentication needs all four
permissions: `companion:read`, `companion:write`, `scratchpad:read`, and
`scratchpad:write`. LU issues rotating refresh tokens for this public client.
The companion permission
covers tasks, reminder status, recent writing and notifications; it does not
expose diary entry text. Work-restricted and organization credentials are refused.

The panel uses Tab to move between controls, Escape to close and Ctrl+Enter to
submit a capture. This command can be assigned to your preferred keyboard shortcut:

```sh
omarchy-shell shell toggle literaryuniverse.companion '{}'
```

Configure background refresh and the three banner toggles in Omarchy's plugin
settings. Daily diary banners also require reminders to be enabled in LU's diary
settings; their hour and timezone come from LU. Refresh runs once a minute while signed in; banners are off by default.
Turning off background refresh also turns off desktop reminders until re-enabled.
The panel still refreshes when opened. Opening notification preferences in LU
controls the underlying Novu workflows.

## Local testing

The helper accepts `LU_COMPANION_URL=http://localhost:4200`. Only HTTPS origins
and HTTP loopback origins are accepted. Restart the test shell with that variable
set; do not change a running production shell just to test. Each origin has a
separate keyring credential and data directory.

```sh
npm test
npm run check
omarchy plugin validate .
printf '%s\n' '{"action":"refresh"}' | LU_COMPANION_URL=http://localhost:4200 node src/bridge.mjs
```

The JSON helper's `login` action opens the browser. Its output contains UI data or
an error code, never credentials. Use the panel for normal interaction.

## Privacy and removal

Tokens live in the OS keyring under `literary-universe-omarchy`. Capture drafts
are stored per account under `$XDG_STATE_HOME/literary-universe-omarchy` (default
`~/.local/state/literary-universe-omarchy`), with private directory/file permissions.
Drafts are plaintext, so disk encryption remains relevant. They survive logout
and removal to avoid losing unsent writing; another account cannot see them in
the panel. No analytics or third-party network requests are added by the plugin.

**Log out** revokes the refresh token before clearing the local credential.
If LU cannot be reached, retry logout when connected, or revoke the grant in LU's
Integrations settings. Removing the plugin alone does not revoke the grant:

```sh
omarchy plugin remove literaryuniverse.companion
```

Export or submit any unsent capture before manually deleting its local state.
Legacy scratchpads with HTML but no editor document must first be saved in LU's
web editor. The desktop appends notes; full rich-text editing stays on the website.

## Contributing and publishing

See [the release checklist](docs/releasing.md) and [the API contract](docs/api.md).
The UI follows Omarchy's shared controls, palette and locale. The multiline field
uses Qt Quick Controls because Omarchy has no multiline editor. The 50 locale
catalogs are bundled and can be corrected through pull requests.

MIT license. The OAuth loopback flow follows the MIT-licensed
[Literary Universe CLI](https://github.com/LiteraryUniverse/cli).
