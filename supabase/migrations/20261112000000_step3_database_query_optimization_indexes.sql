-- ====================================================================
-- RUET Medical: Phase 1, Step 3 — Production-Hardened Database Query Optimization Indexes
-- Target: Supabase PostgreSQL 15 Production (kspnctkuzorfkakdhncc)
-- Operational Requirement: Reviewed production-safe migration strategy
-- Notice: DO NOT EXECUTE AUTOMATICALLY IN PRODUCTION WITHOUT AUTHORIZATION.
--
-- AUDIT FINDINGS:
-- - 20 indexes evaluated across the optimization lifecycle.
-- - 5 indexes removed:
--     * Standalone (patient_id) on lab_reports subsumed by (patient_id, date DESC).
--     * Standalone (patientId) on prescriptions subsumed by ("patientId", date DESC).
--     * Standalone (patientId) on certificates subsumed by ("patientId", date DESC).
--     * Low-selectivity full index on profiles(role) removed to eliminate write overhead.
--     * Non-existent column index on lab_reports("requestId") removed (requestId is in result JSON).
-- - 1 index optimized:
--     * lab_requests(status) converted to partial index for pending worklists.
-- - 15 indexes verified necessary, column-validated, and retained.
-- - Added CREATE INDEX CONCURRENTLY outside of transaction blocks for non-blocking production rollout.
-- ====================================================================

-- 1. Appointments Indexes
-- Speeds up doctor appointment schedule lookups and slot collision detection
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_doctor_date
  ON public.appointments ("doctorId", date);

-- Speeds up patient appointment history lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_patient_id
  ON public.appointments ("patientId");

-- Speeds up chronological sorting for appointment listings
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_created_at_desc
  ON public.appointments ("createdAt" DESC);

-- 2. Prescriptions Indexes
-- Speeds up patient clinical history retrieval (covers both patient filter and date sort)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prescriptions_patient_date
  ON public.prescriptions ("patientId", date DESC);

-- Speeds up doctor's authored prescription queries and doctor-patient relationship validation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prescriptions_doctor_patient
  ON public.prescriptions ("doctorId", "patientId");

-- Speeds up recent prescription listings
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prescriptions_created_at_desc
  ON public.prescriptions ("createdAt" DESC);

-- 3. Laboratory Reports Indexes
-- Composite index covering patient filter and chronological sorting (eliminates full-table scans)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_reports_patient_date
  ON public.lab_reports (patient_id, date DESC);

-- Speeds up chronological laboratory report retrieval
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_reports_date_desc
  ON public.lab_reports (date DESC);

-- 4. Laboratory Requests Indexes
-- Speeds up patient lab request lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_requests_patient_id
  ON public.lab_requests ("patientId");

-- High-selectivity partial index for pending pathologist queue (eliminates full table indexing)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_requests_pending
  ON public.lab_requests ("createdAt" DESC)
  WHERE status = 'Pending';

-- 5. Certificates Indexes
-- Composite index covering patient filter and chronological sorting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificates_patient_date
  ON public.certificates ("patientId", date DESC);

-- Speeds up doctor issued certificate lookups and doctor-patient relationship validation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificates_doctor_patient
  ON public.certificates ("doctorId", "patientId");

-- 6. Patients Table Indexes
-- Speeds up student patient identity resolution by roll number
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patients_roll_number
  ON public.patients (roll_number);

-- Speeds up registration number lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patients_registration_number
  ON public.patients (registration_number);

-- 7. Teachers Table Indexes
-- Speeds up faculty identity resolution by employee ID
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teachers_employee_id
  ON public.teachers (employee_id);

-- ====================================================================
-- ROLLBACK STRATEGY:
-- If any index needs to be rolled back, execute the following:
--
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_appointments_doctor_date;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_appointments_patient_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_appointments_created_at_desc;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_prescriptions_patient_date;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_prescriptions_doctor_patient;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_prescriptions_created_at_desc;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_lab_reports_patient_date;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_lab_reports_date_desc;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_lab_requests_patient_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_lab_requests_pending;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_certificates_patient_date;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_certificates_doctor_patient;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_patients_roll_number;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_patients_registration_number;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_teachers_employee_id;
-- ====================================================================
