# Backend & Frontend Overview

## Overview
The application consists of two separate parts:
- **Frontend** – React application located in the `src/` directory, built and served by Vite.
- **Backend** – Express API server defined in `server.js`, exposing REST endpoints that interact with PostgreSQL.

The frontend no longer accesses the database directly. All data operations are performed through the backend API using the `apiFetch` helper.

## Running the Backend
1. Ensure the `.env` file contains a valid `DATABASE_URL` pointing to your PostgreSQL instance.
2. Install dependencies (if not already done): `npm install`.
3. Start the API server: `npm run dev:server` (or `node server.js`).
   - The server listens on **http://localhost:5000** by default (override with the `PORT` env var).
4. You should see a console message `API server listening on http://localhost:5000`.

## Running the Frontend
1. Install dependencies: `npm install`.
2. Start the development server: `npm run dev`.
   - Vite will launch the app at **http://localhost:5173** (default port).
3. The frontend will make HTTP requests to the backend endpoints defined above.

## Authentication & Authorization
- 인증: 세션 쿠키 기반(in-memory `sessions`, `bcrypt`). 로그인은 `/api/auth/login`.
- **전역 게이트**: `app.use('/api', …)` 이후 등록된 모든 `/api/*` 라우트는 **로그인 세션 필수**(없으면 401). 예외: `/api/auth/*`, `/api/ai/status`, `/health`.
- **[HR]** 표기 라우트는 `requireHr` 미들웨어로 HR 역할(`available_roles`에 `hr` 또는 `admin`)만 허용.
- 평가/과업 데이터는 행 단위 가드(`canAccessEvaluation` 등)로 "본인 / 담당 평가자 / HR"만 접근.

## Available API Endpoints
> 실제 구현 기준(`server.js`). 표기 없는 라우트는 로그인 세션만 필요, **[HR]**는 HR 전용.

**Auth & 세션**
- `POST /api/auth/login` · `GET /api/auth/me` · `POST /api/auth/logout` · `POST /api/auth/change-password` · `POST /api/auth/password-reset-request`
- `GET /api/admin/password-reset-requests` **[HR]** · `POST /api/admin/password-reset-requests/:id/approve` **[HR]** · `…/reject` **[HR]** · `POST /api/admin/password-reset/:employeeId` **[HR]**

**AI**
- `GET /api/ai/status` · `POST /api/ai/chat` (핸들러 내부 세션 검사)

**Employees**
- `GET /api/employee/:id` · `GET /api/employees` · `GET /api/employees/evaluator/:evaluatorId` · `GET /api/employees/former-evaluator/:evaluatorId` · `GET /api/employees/department/:dept`
- `POST /api/employees` **[HR]** · `PUT /api/employee/:id` **[HR]** · `DELETE /api/employee/:id` **[HR]** · `POST /api/employee/:id/evaluator-edit` **[HR]**

**Imports [HR]**
- `GET/POST /api/matching-imports` · `GET /api/matching-imports/latest-rows` · `POST /api/matching-imports/preview`
- `GET/POST /api/employee-profile-imports` · `GET /api/employee-profile-imports/latest-rows`

**Evaluator assignment history**
- `GET /api/evaluator-assignment-history/employee/:employeeId`
- `POST /api/evaluator-assignment-history/:id/cancel` **[HR]** · `…/correct` **[HR]**

**Admin reset [HR]**
- `POST /api/admin/reset/employees` · `POST /api/admin/reset/matching`

**Evaluator mappings**
- `GET /api/evaluator-mappings` · `POST /api/evaluator-mappings` **[HR]**

**Change requests**
- `GET/POST /api/change-requests` · `POST /api/change-requests/:id/cancel`
- `POST /api/change-requests/:id/approve` **[HR]** · `…/reject` **[HR]** · `…/revert` **[HR]**

**Evaluation periods**
- `GET /api/evaluation-periods` · `GET /api/evaluation-periods/current`
- `POST /api/evaluation-periods` **[HR]** · `PUT /api/evaluation-periods/:id` **[HR]** · `DELETE /api/evaluation-periods/:id` **[HR]**

**Evaluations**
- `GET /api/evaluations` **[HR]** · `GET /api/evaluations/current-by-employee` **[HR]** · `GET /api/evaluations/status/:status` **[HR]**
- `GET /api/evaluations/by-employee/:employeeId` · `GET /api/evaluations/employee/:employeeId` · `GET /api/evaluation/:id`
- `POST /api/evaluation` · `PUT /api/evaluation/:id` · `DELETE /api/evaluation/:id` **[HR]**
- `POST /api/evaluation/:id/return-request` · `…/reopen` · `…/reopen-for-evaluator`

**Tasks & evaluation entries**
- `GET /api/tasks/evaluation/:evaluationId` · `GET /api/tasks/current-year` **[HR]**
- `POST /api/task` · `PUT /api/task/:id` · `PATCH /api/task/:id` · `DELETE /api/task/:id`
- `GET /api/task-evaluation-entries/evaluation/:evaluationId` · `PUT /api/task-evaluation-entry`

**Feedback**
- `GET /api/feedbacks` **[HR]** · `GET /api/feedback/:id` · `POST /api/feedback` · `DELETE /api/feedback/:id` **[HR]** · `GET /api/feedbacks/task/:taskId`

**Notifications**
- `GET /api/notifications` · `PUT /api/notifications/read-all` · `DELETE /api/notifications`
- `GET /api/notification/:id` · `POST /api/notification` · `PUT /api/notification/:id/read` · `DELETE /api/notification/:id`

**Settings**
- `GET /api/settings/:userId/:type` · `GET /api/settings/:userId` · `POST /api/setting` · `DELETE /api/setting/:userId/:type`

**Prompts**
- `GET /api/prompts` · `GET /api/prompt/:key` · `PUT /api/prompt/:key` **[HR]** · `DELETE /api/prompt/:key` **[HR]**

**Evaluator QnA logs**
- `POST /api/evaluator-qna-logs` · `GET /api/evaluator-qna-logs` **[HR]**

**Health**
- `GET /health`

## Notes
- The frontend uses `src/lib/api.ts` to call these endpoints.
- Ensure CORS is allowed (already configured).
- For production, set `NODE_ENV=production` and configure a reverse proxy if needed.

## License
(Provide license information here if applicable.)