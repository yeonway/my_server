# Notification Center Architecture

## Overview

The notification center lets members review mentions, direct messages, comments, announcements and more from a single surface. The UI exposes filter tabs, a badge counter, a bulk read action, a detail modal and a quick-reply composer for supported notification types (currently direct messages). Back-end endpoints power both the dropdown list and the modal detail view while Socket.IO keeps unread counters and new entries in sync.

## Data Model

Notifications are stored in MongoDB using `models/notification.js`.

```js
{
  recipient: ObjectId,          // notification owner (indexed)
  actor: ObjectId | null,       // optional user that triggered the event
  type: 'comment' | 'mention' | 'dm' | 'group_invite' | 'announcement',
  message: string,              // short message surfaced in lists and modal title
  link: string | null,          // optional deep link
  payload: {                    // arbitrary metadata exposed in the modal
    chatroomId?: string,
    roomId?: string,
    commentId?: string,
    preview?: string,
    quickReply?: {              // added automatically for DM notifications
      type: 'dm',
      roomId: string
    }
  },
  read: boolean,
  readAt: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

`payload.quickReply` is hydrated automatically for `dm` notifications so that the front end can render the quick reply composer. The service also exposes aggregated counts per type (total/unread) that the UI uses to decorate filter tabs.

## REST API

All notification endpoints are available under `/api/notifications` and require authentication.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/` | List notifications. Accepts `limit` (max 200), `status=unread`, `types=mention,dm,...` and `cursor` for pagination. Returns `{ notifications, unreadCount, summary, nextCursor }`. |
| `GET` | `/:id` | Fetch detailed metadata for a single notification (used by the modal). |
| `PATCH` | `/:id/read` | Mark a single notification as read. Returns `{ notification, unreadCount, summary }`. |
| `POST` | `/read-all` | Mark every unread notification as read. Returns `{ success, updated, unreadCount, summary }`. |
| `POST` | `/:id/reply` | Send a quick reply for notifications that expose `payload.quickReply`. Currently supports direct-message notifications and returns `{ notification, message, unreadCount, summary }`. |

Errors:
- `401` invalid/expired token – the front end hides the center and disconnects sockets.
- `403/404` user not permitted or notification missing.
- `429/500` surfaced as generic error banners in the dropdown/modal.

## Real-time Updates

Socket.IO connects once a token is available (`io({ auth: { token } })`) and listens for:

- `notification:new` – prepend the notification, update counters.
- `notification:updated` – replace the notification, adjust counters if read status changed.
- `notification:read-all` – force all current notifications to a read state.

The server joins each user to a private room (`userId.toString()`) and emits these events whenever a change occurs.

## Front-end UX Flow

1. **Trigger and badge** – A bell icon displays the unread count and toggles the dropdown.
2. **Dropdown** – Shows filter tabs (`전체`, `멘션`, `DM`, `댓글`, `공지`) and a scrollable list of notifications. Tabs use per-type unread counts returned by the API.
3. **Detail modal** – Selecting a list item marks it read (via REST), closes the dropdown and opens a modal with extended metadata plus an optional payload block.
4. **Quick reply** – When `payload.quickReply.type === 'dm'`, the modal exposes a textarea that posts to `POST /:id/reply` and updates the list in place.
5. **Bulk read** – `전체 읽음` posts to `/read-all`, zeros unread counts, and broadcasts a socket event so other sessions stay in sync.

The front end maintains local caches per filter, merges socket updates, and falls back to refetching whenever an error or token refresh occurs.

## Error Handling Strategy

- Unauthorized responses trigger a complete reset (hide center, clear caches, disconnect socket).
- Network/API failures surface inline error messages (`알림을 불러오지 못했습니다.` etc.) while keeping previously loaded data intact.
- Quick-reply validation errors render beneath the composer without closing the modal.
- Socket disconnects fail silently—next successful token refresh reinitializes the connection and list.

