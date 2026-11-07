# Companion API v1

All endpoints are relative to the selected LU origin and use Bearer credentials.
Only personal OAuth/API credentials with no resource restrictions are accepted.
No cookies are used. Responses are private and `no-store`. The server checks
authentication, scopes and rate limits before parsing a body.

| Method and path | Scope | Result / request |
| --- | --- | --- |
| GET `/api/companion/v1/summary` | `companion:read` | `userId`, `resume` (`title`, internal `path`), unfinished `tasks` (`id`, `title`, `version`, optional `dueDate`), `diary` (`date`, `due`, `complete`) |
| GET `/api/companion/v1/scratchpad` | `scratchpad:read` | Last 20,000 characters as `text`, `updatedAt` |
| POST `/api/companion/v1/capture` | `scratchpad:write` | `{id: UUID, text}`; append up to 20,000 characters, preserve formatting, deduplicate the latest 100 capture IDs |
| POST `/api/companion/v1/tasks` | `companion:write` | `add` with `itemId` and `fields.title`, or `complete` with `itemId`, `version`, `completed`; the server assigns the personal list |
| GET `/api/companion/v1/notifications` | `companion:read` | `available`, `items` (`id`, `title`, `read`, `createdAt`, `category`, internal `path`), `hasMore` |
| POST `/api/companion/v1/notifications/read` | `companion:write` | `{id}`; subscriber identity is derived on the server |
| GET `/api/companion/v1/article` | `companion:read` | Latest official blog article (`title`, `publishedAt`, internal `path`) or null |

`401` requires sign-in; `403` means permission, account type, restrictions or task
subscription; `409` means a version conflict; `429` supplies `Retry-After`; `503`
means unavailable. The plugin preserves pending captures on uncertain failure
and retries the same ID/text. It never automatically replays a write.

Only the helper sees access/refresh tokens. QML sends bounded JSON commands over
stdin and receives bounded JSON UI state. Local file locking serializes token
rotation and state writes across shell instances. Redirects are refused on API
requests. Browser destinations stay on the selected LU origin.
