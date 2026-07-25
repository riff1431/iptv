
-- Uploaders can insert only into their own folder (first path segment = auth.uid())
CREATE POLICY "msg-att: users insert own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'message-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Owners can read their own uploads directly (recipients get signed URLs via a server function)
CREATE POLICY "msg-att: users read own folder"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Owners can update/delete their own uploads
CREATE POLICY "msg-att: users update own folder"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'message-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "msg-att: users delete own folder"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
