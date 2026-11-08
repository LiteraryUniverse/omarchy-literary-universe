# Companion API v1

All endpoints are relative to the selected LU origin and use Bearer credentials.
Only personal OAuth/API credentials with no resource restrictions are accepted.
No cookies are used. Responses are private and `no-store`. The server checks
authentication, scopes and rate limits before parsing a body.

| Method and path | Scope | Result / request |
| --- | --- | --- |
| GET `/api/companion/v1/summary` | `companion:read` | `userId`, `resume` (`title`, internal `path`), `diary` (`date`, `due`, `complete`) |
| GET `/api/companion/v1/scratchpad` | `scratchpad:read` | Last 20,000 characters as `text`, `updatedAt` |
| POST `/api/companion/v1/capture` | `scratchpad:write` | `{id: UUID, text}`; append up to 20,000 characters, preserve formatting, deduplicate the latest 100 capture IDs |
| GET `/api/companion/v1/tasks` | `tasks:read` | `items`: up to 100 unfinished personal tasks (`id`, `title`, `version`, optional `dueDate`) |
| POST `/api/companion/v1/tasks` | `tasks:write` | `add` with `itemId` and `fields.title`, or `complete` with `itemId`, `version`, `completed`; the server assigns the personal list |
| GET `/api/companion/v1/notifications` | `notifications:read` | `available`, `items` (`id`, `title`, `read`, `createdAt`, `category`, internal `path`), `hasMore` |
| POST `/api/companion/v1/notifications/read` | `notifications:write` | `{id}`; subscriber identity is derived on the server |
| GET `/api/companion/v1/article` | `companion:read` | Latest official blog article (`title`, `publishedAt`, internal `path`) or null |

Each permission is independent: read does not imply write, and write does not
imply read. A task-sync client such as a future Todoist integration can request
only `tasks:read tasks:write`; it cannot read notifications, writing activity,
reminder status or scratchpad data. The summary endpoint never reads tasks.

`400` means invalid input; `401` requires sign-in; `403` means permission, account
type, restrictions or task subscription; `404` means the task no longer exists;
`409` means a version conflict; `413` means the content is too large; `422` means
LU refused the change (task limit, unavailable task link, or a legacy scratchpad
that must be opened on the web first); `429` supplies `Retry-After`; `503` means
unavailable. The body's `error` field names the specific reason. The plugin preserves pending captures on uncertain failure
and retries the same ID/text. It never automatically replays a write.

Only the helper sees access/refresh tokens. QML sends bounded JSON commands over
stdin and receives bounded JSON UI state. Local file locking serializes token
rotation and state writes across shell instances. Redirects are refused on API
requests. Browser destinations stay on the selected LU origin.
