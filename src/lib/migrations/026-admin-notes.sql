-- Owner's private note on an order (holds, complimentary items, pickup changes).
-- Shown only in admin: All Orders, Production Planning, Ship panel, 9 AM prep email.
ALTER TABLE orders ADD COLUMN admin_note TEXT;
