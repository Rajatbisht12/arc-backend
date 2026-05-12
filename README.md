# ARC Modular Backend

A **fully self-contained modular monolith** backend for ARC Squad Hunt.

- **Single deployable service** — no dependency on `../backend` anymore.
- **Feature modules** with clean boundaries for future extraction.
- **Shared infrastructure** for MongoDB, Redis, and Socket.IO.
- **Horizontal scale-ready sockets** using the Redis adapter.
- **Legacy JS source** lives in `src/legacy-src/` (controllers, models, middleware, utils) and is consumed by TypeScript adapter layers.

## Folder Layout

```text
src/
  config/               # env validation, logger
  infrastructure/       # MongoDB, Redis, Socket.IO setup
    cache/
    database/
    websocket/
  modules/              # 25 feature modules + legacy glue
    admin/
    ai-coach/
    ai-recruitment/
    auth/
    challenges/
    chat/                # native TypeScript module
    feedback/
    health/              # native TypeScript module
    host-verification/
    knowledge/
    leave-requests/
    legacy/              # passport init, static uploads, socket handlers
    membership/
    messages/
    monetization/
    music/
    notifications/
    payments/
    posts/
    random-connections/
    recruitment/
    reports/
    scrims/
    stories/
    tournaments/
    users/
  shared/               # shared auth middleware (native TS)
  legacy-src/           # all original JS source code
    config/
    controllers/
    data/
    jobs/
    middleware/
    models/
    routes/
    scripts/
    services/
    uploads/
    utils/
```

## Quick Start

1. Copy `.env.example` to `.env` and update values.
2. Install dependencies:

```bash
npm install
```

3. Start local dependencies and API:

```bash
docker compose up --build
```

4. Or run directly (with MongoDB + Redis already running):

```bash
npm run dev
```

## Module Map

All routes are registered as dedicated modules:

| Mount Path | Module | Status |
|---|---|---|
| `/api/auth` | `auth` | Bridged |
| `/api/users` | `users` | Bridged |
| `/api/messages` | `messages` | Bridged |
| `/api/notifications` | `notifications` | Native + Bridged |
| `/api/posts` | `posts` | Bridged |
| `/api/tournaments` | `tournaments` | Bridged |
| `/api/scrims` | `scrims` | Bridged |
| `/api/recruitment` | `recruitment` | Bridged |
| `/api/challenges` | `challenges` | Bridged |
| `/api/admin` | `admin` | Bridged |
| `/api/chat` | `chat` | Native |
| `/api/health` | `health` | Native |
| `/api/leave-requests` | `leave-requests` | Bridged |
| `/api/random-connections` | `random-connections` | Bridged |
| `/api/monetization` | `monetization` | Bridged |
| `/api/feedback` | `feedback` | Bridged |
| `/api/reports` | `reports` | Bridged |
| `/api/ai-coach` | `ai-coach` | Bridged |
| `/api/ai-recruitment` | `ai-recruitment` | Bridged |
| `/api/knowledge` | `knowledge` | Bridged |
| `/api/membership` | `membership` | Bridged |
| `/api/music` | `music` | Bridged |
| `/api/stories` | `stories` | Bridged |
| `/api/payments` | `payments` | Bridged |
| `/api/host-verification` | `host-verification` | Bridged |

**Bridged** = TypeScript routes calling JS controllers in `legacy-src/`.
**Native** = fully self-contained TypeScript in the module.

## Chat API

- `GET /api/chat/:chatId/messages` (auth required)
- `POST /api/chat/messages` (auth required)

## Socket Events

Client emits:
- `join-user-room` (`userId`)
- `join-chat-room` (`chatRoomId`)
- `leave-chat-room` (`chatRoomId | "all"`)
- `send-message` (`{ chatId, text }`)

Server emits:
- `newMessage` (`{ chatId, message }`)

Legacy socket events for random connections and voice/video/group calls are also enabled.

## Scaling Notes

- Redis is used for both short-lived caching and Socket.IO pub/sub adapter.
- MongoDB connection pool is tuned for production defaults.
- Modules can later be extracted to microservices without rewriting core business logic.
- To convert a bridged module to native TS, rewrite its controller logic in the module directory and remove the `legacy-adapters` file.
