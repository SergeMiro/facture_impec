-- invoices.status is written only by applyTransition (src/transition.ts), which sets fi.status_write
-- for the duration of its UPDATE. Any other write of the column fails (plan §4).
CREATE FUNCTION fi_guard_invoice_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('fi.status_write', true), '') <> 'on' AND (
    (TG_OP = 'INSERT' AND NEW.status <> 'draft') OR
    (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status)
  ) THEN
    RAISE EXCEPTION 'invoices.status changes only through applyTransition' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoices_status_guard BEFORE INSERT OR UPDATE OF status ON invoices
  FOR EACH ROW EXECUTE FUNCTION fi_guard_invoice_status();
--> statement-breakpoint
-- audit_events is append-only (plan §10); production also withholds UPDATE/DELETE grants.
CREATE FUNCTION fi_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'P0001';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION fi_audit_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION fi_audit_append_only();
