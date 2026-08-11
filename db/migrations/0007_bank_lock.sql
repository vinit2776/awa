-- 0007_bank_lock.sql
-- Bank-detail lock + out-of-band verification (§05). registered_phone is
-- the vendor's originally-registered number — the one someone calls to
-- verify a bank-detail change, never a number supplied alongside the
-- change request itself (that would defeat the whole point). last4 is
-- stored in cleartext alongside the encrypted account number so the UI
-- never needs to decrypt just to render a masked display. No existing
-- rows in vendor_bank_accounts (unused until this sprint), so last4
-- can be added not-null with no backfill.
alter table vendors
  add column registered_phone text;

alter table vendor_bank_accounts
  add column account_number_last4 text not null;
