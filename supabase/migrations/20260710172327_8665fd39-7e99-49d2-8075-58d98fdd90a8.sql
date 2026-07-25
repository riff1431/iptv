
-- Allow admins to upload/manage objects in the private match-thumbnails bucket.
-- Public reads happen via signed URLs generated at upload time, so no anon SELECT policy is needed.
CREATE POLICY "Admins can insert match thumbnails"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'match-thumbnails' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update match thumbnails"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'match-thumbnails' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete match thumbnails"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'match-thumbnails' AND public.has_role(auth.uid(), 'admin'));

-- Admins need SELECT to generate signed URLs for the uploaded objects.
CREATE POLICY "Admins can read match thumbnails"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'match-thumbnails' AND public.has_role(auth.uid(), 'admin'));
