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

## Available API Endpoints
- `GET /api/employee/:id` – Get single employee.
- `GET /api/employees` – List all employees.
- `GET /api/employees/evaluator/:evaluatorId` – Employees by evaluator.
- `GET /api/employees/department/:dept` – Employees by department.
- `PUT /api/employee/:id` – Update employee.
- `GET /api/evaluations` – List evaluations.
- `GET /api/evaluation/:id` – Get evaluation.
- `POST /api/evaluation` – Create evaluation.
- `PUT /api/evaluation/:id` – Update evaluation.
- `DELETE /api/evaluation/:id` – Delete evaluation.
- `GET /api/feedbacks` – List feedbacks.
- `POST /api/feedback` – Create feedback.
- `DELETE /api/feedback/:id` – Delete feedback.
- `GET /api/notifications` – List notifications.
- `POST /api/notification` – Create notification.
- `PUT /api/notification/:id/read` – Mark as read.
- `DELETE /api/notification/:id` – Delete notification.
- `GET /api/settings/:userId/:type` – Get setting.
- `POST /api/setting` – Upsert setting.
- `DELETE /api/setting/:userId/:type` – Delete setting.
- `GET /api/tasks` – List tasks.
- `GET /api/task/:id` – Get task.
- `POST /api/task` – Create task.
- `PUT /api/task/:id` – Update task.
- `DELETE /api/task/:id` – Delete task.

## Notes
- The frontend uses `src/lib/api.ts` to call these endpoints.
- Ensure CORS is allowed (already configured).
- For production, set `NODE_ENV=production` and configure a reverse proxy if needed.

## License
(Provide license information here if applicable.)