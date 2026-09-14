-- Run in Supabase SQL Editor. Grants the app (logged-in user) read access
-- to photos/cameras, write access to tags, and read access to images.
-- The sync script's service key bypasses all of this; it is unaffected.

alter table reveal_photos add column if not exists reviewed boolean default false;

alter table reveal_photos enable row level security;
alter table reveal_cameras enable row level security;

drop policy if exists "app read photos" on reveal_photos;
create policy "app read photos" on reveal_photos
  for select to authenticated using (true);

drop policy if exists "app tag photos" on reveal_photos;
create policy "app tag photos" on reveal_photos
  for update to authenticated using (true) with check (true);

drop policy if exists "app read cameras" on reveal_cameras;
create policy "app read cameras" on reveal_cameras
  for select to authenticated using (true);

drop policy if exists "app read images" on storage.objects;
create policy "app read images" on storage.objects
  for select to authenticated using (bucket_id = 'trail-photos');
