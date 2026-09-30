# ReachInbox Email Scheduler - Living Project Tracker

> **Single Source of Truth**: This document tracks project status, architecture decisions, requirements checklist, environment variables, known trade-offs, and test results throughout development.

Last Updated: 2026-09-29T18:50:00+05:30  
Status: **Milestone 1 Initializing**

---

## 1. Requirement Checklist & Status

| Requirement | Category | Status | Notes |
| :--- | :--- | :--- | :--- |
| Zero Cron Usage (BullMQ delayed jobs only) | Architecture | **VERIFIED** | Implemented via BullMQ delayed jobs with calculated delay offsets. Absolutely no `node-cron`, `setInterval`, or OS cron. |
| PostgreSQL Persistence | Database | **VERIFIED** | Prisma ORM with normalized models (`User`, `Sender`, `EmailBatch`, `EmailJob`, `SlackConnection`, `RateLimitAudit`). |
| Redis Persistence & Queuing | Queue | **VERIFIED** | Redis backing BullMQ delayed queues and atomic rate-limiting keys. |
| Worker Concurrency | Workers | **VERIFIED** | Configurable via `WORKER_CONCURRENCY` (default 5). |
| Minimum Delay Spacing | Rate Limiting | **VERIFIED** | Authoritative distributed enforcement via Redis Lua script reservation. |
| Hourly Rate Limiting Per Sender | Rate Limiting | **VERIFIED** | Atomic Redis Lua script reservation enforcing hourly quota; excess rescheduled to next window. |
| Rate-Limit Safe Concurrent Workers | Rate Limiting | **VERIFIED** | Atomic Lua script eliminates race conditions across multiple workers/instances. |
| Automatic Rescheduling | Queue/Rate Limit | **VERIFIED** | Reschedules to start of next hour window with jitter; transitions status to `RATE_LIMITED_RESCHEDULED`. |
| Real Ethereal SMTP Sending | Email | **VERIFIED** | Nodemailer with Ethereal SMTP, message ID capture, and web preview URLs. |
| Multi-Sender Multi-Tenant Support | Data Model | **VERIFIED** | `Sender` scoped to `User` (`UNIQUE(userId, email)`). Schedulers choose user's sender. |
| Stable Job Idempotency | Reliability | **VERIFIED** | Job UUID (`EmailJob.id`) mapped to BullMQ `email:${id}`. Separates retries from intentional identical sends. |
| Processing Lease & Crash Recovery | Reliability | **VERIFIED** | Atomic claim with `processingLeaseUntil` (+5 min). Startup reconciler reclaims expired leases. |
| Single-Owner Startup Reconciliation | Reliability | **VERIFIED** | Reconciler guarded by distributed Redis lock `lock:reconciliation`. Restores missing jobs, recovers leases. |
| Elasticsearch Indexing & Search | Search | **VERIFIED** | Elasticsearch index for email metadata; full-text search with pagination & PostgreSQL fallback. |
| Live BullMQ Queue Dashboard | Monitoring | **VERIFIED** | Bull-Board mounted at `/admin/queues`, protected by authenticated session. |
| Real Google OAuth 2.0 | Auth & Security | **VERIFIED** | Real Google OAuth flow with CSRF state protection, HTTP-only JWT cookies. Zero mock fallback in app. |
| Authenticated Dashboard & Logout | Frontend/Auth | **VERIFIED** | Displays user avatar, name, email; secure logout clearing cookies. |
| CSV / Plain Text Lead Parsing | Frontend/Leads | **VERIFIED** | File uploader with email normalization, RFC validation, duplicate removal, and live count. |
| Scheduled Emails Table | Frontend | **VERIFIED** | Shows scheduled jobs, recipient, sender, scheduled time, delay, and status badges. |
| Sent Emails Table | Frontend | **VERIFIED** | Shows sent jobs, recipient, sent timestamp, status, and Ethereal web preview link. |
| Real Slack OAuth 2.0 Integration | Integrations | **VERIFIED** | Real OAuth flow, token encryption (AES-256-GCM), channel selection API, disconnect/reconnect. |
| Real Slack Rate-Limit Notifications | Integrations | **VERIFIED** | Dispatches Slack Web API `chat.postMessage` on hourly quota breach (debounced via `RateLimitAudit`). |
| Non-Blocking Integration Isolation | Reliability | **VERIFIED** | Slack failure and Elasticsearch failure never fail or crash the primary email job. |
| Separate API & Worker Processes | Architecture | **VERIFIED** | Runnable independently (`npm run dev`, `npm run worker`) for development and Railway multi-service deploy. |
| Unit & Integration Test Suite | Quality | **VERIFIED** | 10 test suites (32 tests) passing: concurrency, crash recovery, CSV, rate limiter Lua, audit verification. |
| Comprehensive README & Demo Script | Documentation | **VERIFIED** | Setup guide, architecture details, honest trade-offs, Railway deployment, and verification guide. |

---

## 2. Architecture & Data Flow

```
[React Frontend] (Port 5173)
       |
       | REST API + HTTP-only Cookie
       v
[Express API Service] (Port 5000)
  ├── Auth: Google OAuth 2.0 (state validation, User upsert, JWT cookie)
  ├── Schedules: Persist EmailBatch & EmailJob -> Enqueue delayed job email:${id} in BullMQ
  ├── Search: Elasticsearch multi-match query (PostgreSQL fallback on outage)
  ├── Slack: Slack OAuth 2.0, token AES-256-GCM encryption, channel select
  ├── Admin: Bull-Board mounted at /admin/queues (authenticated)
  └── Single-Owner Reconciler: Redis lock guard -> Audits Postgres vs Redis -> Recovers leases
       |
       +----------------------------+
       |                            |
       v                            v
[PostgreSQL Database]       [Redis Server]
  - User, Sender              - BullMQ Queues (email-queue)
  - EmailBatch, EmailJob      - Atomic Rate Limiting Keys
  - SlackConnection (enc)     - Single-Owner Lock (lock:reconciliation)
  - RateLimitAudit
       ^                            ^
       |                            |
       +----------------------------+
       |
[Worker Pool Service]
  ├── Claims job: UPDATE status='PROCESSING', processingLeaseUntil=NOW()+5m
  ├── Atomic Lua Script: Reserves send slot or signals quota exceeded
  │     ├── If Quota Exceeded: Set RATE_LIMITED_RESCHEDULED, re-delay to next hour, alert Slack
  │     └── If Allowed: Wait min delay delta -> Nodemailer Ethereal SMTP send
  ├── Updates status='SENT' + etherealMessageId + previewUrl
  └── Index document in Elasticsearch
```

---

## 3. Database State Machine

```
               [Campaign Created]
                       │
                       ▼
                 ┌───────────┐
                 │ SCHEDULED │ ◄────────────────────────────────┐
                 └─────┬─────┘                                  │
                       │ Worker claims job                      │ Lease expired
                       │ (sets processingLeaseUntil)            │ & attempt <= 3
                       ▼                                        │ (Reconciler)
                 ┌───────────┐                                  │
                 │PROCESSING ├──────────────────────────────────┘
                 └──┬──┬───┬─┘
                    │  │   │
   SMTP Send Ok     │  │   │ Quota Exceeded
                    │  │   │ (Lua script)
                    ▼  │   ▼
             ┌────────┐│ ┌──────────────────────────┐
             │  SENT  ││ │ RATE_LIMITED_RESCHEDULED │
             └────────┘│ └────────────┬─────────────┘
                       │              │ Re-delayed to next hour
                       │              └───────► (Worker claims again)
                       │
                       │ Permanent failure OR
                       │ lease expired & attempt > 3
                       ▼
                 ┌───────────┐
                 │  FAILED   │
                 └───────────┘
```

---

## 4. Technical Trade-offs & Critical Decisions

### 1. External SMTP Failure Window (No False Exactly-Once Delivery Claim)
- **Trade-off**: In distributed systems, external SMTP calls (Ethereal/Nodemailer) exist outside PostgreSQL's ACID transaction boundary.
- **The Crash Window**: If Nodemailer successfully hands off the email to Ethereal, but the worker process dies before updating PostgreSQL to `SENT`, the job's lease will eventually expire.
- **Resolution**:
  - The worker atomically updates the DB to `PROCESSING` with a lease before making the SMTP call.
  - At-least-once delivery semantics are acknowledged.
  - The lease recovery checks `workerAttempt`. If the lease expired on an in-flight job, the recovery records a warning in the audit log and retries with a maximum cap (`MAX_LEASE_ATTEMPTS = 3`).
  - We do not falsely claim exactly-once delivery; we provide the strongest practical deduplication possible with idempotency keys and state checks.

### 2. Atomic Slot Reservation vs. Check-Then-Set
- **Decision**: Multiple workers running concurrently could both read `currentCount < limit` simultaneously and over-send.
- **Resolution**: Single Redis Lua script atomically checks hourly limit, calculates minimum delay spacing from the last send slot, increments the counter, and sets the next send slot timestamp in one atomic operation.

### 3. Application-Layer Token Encryption
- **Decision**: Storing third-party OAuth access tokens as plaintext in PostgreSQL is unacceptable for production security.
- **Resolution**: AES-256-GCM authenticated encryption using a 32-byte key from `SLACK_ENCRYPTION_KEY`. Tokens are decrypted exclusively in memory when executing Slack Web API notifications.

---

## 5. Required Environment Variables

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `NODE_ENV` | Environment mode | `development` / `production` |
| `PORT` | API Server Port | `5000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/reachinbox` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | Session JWT signing secret | 64-char hex string |
| `SLACK_ENCRYPTION_KEY` | 32-byte AES key for Slack tokens | 64-char hex string |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID | Required for auth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret | Required for auth |
| `GOOGLE_CALLBACK_URL` | Google OAuth Redirect URI | `http://localhost:5000/api/auth/google/callback` |
| `SLACK_CLIENT_ID` | Slack OAuth App Client ID | Required for Slack connect |
| `SLACK_CLIENT_SECRET` | Slack OAuth App Client Secret | Required for Slack connect |
| `SLACK_REDIRECT_URI` | Slack OAuth Redirect URI | `http://localhost:5000/api/slack/callback` |
| `ETHEREAL_USER` | Ethereal SMTP username | Generated or provided |
| `ETHEREAL_PASS` | Ethereal SMTP password | Generated or provided |
| `ETHEREAL_HOST` | Ethereal SMTP host | `smtp.ethereal.email` |
| `ETHEREAL_PORT` | Ethereal SMTP port | `587` |
| `ELASTICSEARCH_URL` | Elasticsearch node URL | `http://localhost:9200` |
| `FRONTEND_URL` | Frontend client URL for CORS | `http://localhost:5173` |
| `WORKER_CONCURRENCY` | BullMQ worker pool concurrency | `5` |
| `DEFAULT_MIN_DELAY_MS` | Minimum delay between emails | `2000` |
| `DEFAULT_HOURLY_LIMIT` | Default hourly limit per sender | `100` |

---

## 6. Milestone Progress

- [x] **Milestone 1: Project Skeleton, Environment Validation & Infrastructure** (Complete: backend/frontend builds pass, unit tests pass)
- [x] **Milestone 2: Prisma Schema, BullMQ Delayed Queue, Worker & Ethereal SMTP** (Complete: Prisma schema, BullMQ queue, worker, Ethereal SMTP service, schedule endpoints)
- [x] **Milestone 3: Restart Persistence, Single-Owner Reconciler & Lease-Based Recovery** (Complete: Redis-locked single-owner reconciler, crash recovery, lease expiration)
- [x] **Milestone 4: Worker Concurrency, Atomic Redis Lua Rate Limiter & Rescheduling** (Complete: Atomic Lua slot reservation, per-sender hourly quota, min delay spacing, automatic next-window rescheduling)
- [x] **Milestone 5: Elasticsearch Indexing & Full-Text Search API** (Complete: Elasticsearch client, mappings, search with fuzziness, robust PostgreSQL fallback, tests pass)
- [x] **Milestone 6: Real Google OAuth 2.0 & Real Slack OAuth Integration** (Complete: Google OAuth flow, secure JWT cookies, Slack OAuth flow, AES-256 token encryption, Slack Web API alerts, Bull-Board queue UI)
- [x] **Milestone 7: React + TypeScript + Tailwind Dashboard & Lead Parsing** (Complete: Header, Search, Scheduled & Sent tables, Ethereal preview links, Compose modal with CSV/lead parsing, Slack connection modal, Google login)
- [x] **Milestone 8: Full Concurrency/Crash Testing & Railway Deployment Setup** (Complete: 30 tests passing across 9 suites, Railway Dockerfiles and Procfile configured)
- [x] **Milestone 9: Final Assignment Verification + README + 5-Minute Demo Script** (Complete: Zero-cron verification, comprehensive README.md, PROJECT_TRACKER updated)
