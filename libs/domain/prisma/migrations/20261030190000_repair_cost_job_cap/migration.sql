-- A MotorFix repair's cost is the job's final price, which goes up to
-- PAID_BANI_MAX; a garage's typed correction keeps its own lower cap.
ALTER TABLE "repair"
    DROP CONSTRAINT "repair_cost_bani_check",
    ADD CONSTRAINT "repair_cost_bani_check" CHECK ("cost_bani" BETWEEN 0 AND 100000000);
