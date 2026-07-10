-- db_mig/add_deleted_at_to_tasks.sql
-- Add a soft‑delete timestamp column to the tasks table.
-- This column allows the DELETE /api/task/:id endpoint to mark a task as deleted
-- without physically removing the row.

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;