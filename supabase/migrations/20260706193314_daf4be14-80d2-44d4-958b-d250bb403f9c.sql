
ALTER TABLE public.topup_requests
  ADD COLUMN proof_path text;

-- Storage policies for the private topup-proofs bucket.
-- Files are stored under a per-user folder: "<user_id>/<filename>".

CREATE POLICY "Users can upload their own topup proofs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'topup-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view their own topup proofs"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'topup-proofs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'admin')
    )
  );

CREATE POLICY "Users can delete their own topup proofs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'topup-proofs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'admin')
    )
  );
