-- Storage Buckets & Policies Setup
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('match-thumbnails', 'match-thumbnails', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('site-assets', 'site-assets', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon']),
  ('avatars', 'avatars', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('message-attachments', 'message-attachments', true, 10485760, NULL),
  ('ad-assets', 'ad-assets', true, 20971520, NULL)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Public Read access policy for storage objects
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Public Access for match-thumbnails'
  ) THEN
    CREATE POLICY "Public Access for match-thumbnails" ON storage.objects
      FOR SELECT USING (bucket_id = 'match-thumbnails');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Public Access for site-assets'
  ) THEN
    CREATE POLICY "Public Access for site-assets" ON storage.objects
      FOR SELECT USING (bucket_id = 'site-assets');
  END IF;
END $$;
