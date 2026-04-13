-- Run this once as postgres superuser:
-- psql -U postgres -f setup_db.sql

CREATE DATABASE translan_data;
\c translan_data

CREATE EXTENSION IF NOT EXISTS vector;

-- Verify
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
