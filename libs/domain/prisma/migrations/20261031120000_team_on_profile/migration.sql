-- The owner's switch over the whole team on the public profile, and the
-- garage's choice of which mechanics a driver may ask for by name.
ALTER TABLE garage ADD COLUMN team_on_profile BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE mechanic ADD COLUMN takes_direct_requests BOOLEAN NOT NULL DEFAULT true;
