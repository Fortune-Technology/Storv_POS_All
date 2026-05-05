-- S79b (F27) — fuel_pumps.pumpNumber: int → text
-- Idempotent: only runs the cast when the column type is still 'integer'.
-- Existing integer values (1, 2, 3...) become strings ('1', '2', '3').
-- Back-compat: any code that compared pumpNumber === 5 still works because
-- "5" === "5" after a change to controller-side equality (handled in F27b).

DO $$
DECLARE
  current_type text;
BEGIN
  SELECT data_type INTO current_type
  FROM information_schema.columns
  WHERE table_name = 'fuel_pumps' AND column_name = 'pumpNumber';

  IF current_type = 'integer' THEN
    ALTER TABLE "fuel_pumps"
      ALTER COLUMN "pumpNumber" TYPE TEXT
      USING "pumpNumber"::text;
    RAISE NOTICE 'fuel_pumps.pumpNumber: integer → text';
  ELSE
    RAISE NOTICE 'fuel_pumps.pumpNumber already %, skipping', current_type;
  END IF;
END $$;
