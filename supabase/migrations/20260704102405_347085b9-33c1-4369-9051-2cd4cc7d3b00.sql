
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.tv_status AS ENUM ('offline', 'online', 'error', 'unconfigured');
CREATE TYPE public.iptv_conn_type AS ENUM ('xtream', 'm3u', 'hls');
CREATE TYPE public.chat_scope AS ENUM ('all', 'tv1', 'tv2', 'tv3', 'tv4');
CREATE TYPE public.session_status AS ENUM ('preview', 'paid', 'expired');
CREATE TYPE public.wallet_tx_type AS ENUM ('debit_lounge_entry', 'refund', 'credit');

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'PGX Fan',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- USER ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins view all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- LOUNGES
CREATE TABLE public.lounges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT,
  vibe TEXT DEFAULT 'Themed',
  entry_fee_cents INTEGER NOT NULL DEFAULT 500,
  free_preview_seconds INTEGER NOT NULL DEFAULT 120,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_private BOOLEAN NOT NULL DEFAULT false,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.lounges TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.lounges TO authenticated;
GRANT ALL ON public.lounges TO service_role;
ALTER TABLE public.lounges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public lounges viewable by anyone" ON public.lounges FOR SELECT USING (is_active = true AND is_private = false);
CREATE POLICY "Private lounges viewable by owner" ON public.lounges FOR SELECT TO authenticated USING (is_private = true AND owner_user_id = auth.uid());
CREATE POLICY "Admins view all lounges" ON public.lounges FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage lounges" ON public.lounges FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_lounges_updated_at BEFORE UPDATE ON public.lounges FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- TVs (admin-only; safe view + accessor for the public)
CREATE TABLE public.tvs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lounge_id UUID NOT NULL REFERENCES public.lounges(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 8),
  display_name TEXT,
  provider_name TEXT,
  server_url TEXT,
  username TEXT,
  password TEXT,
  connection_type public.iptv_conn_type NOT NULL DEFAULT 'xtream',
  selected_channel_id TEXT,
  selected_channel_name TEXT,
  selected_channel_logo TEXT,
  current_stream_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  status public.tv_status NOT NULL DEFAULT 'unconfigured',
  last_status_message TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lounge_id, slot)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tvs TO authenticated;
GRANT ALL ON public.tvs TO service_role;
ALTER TABLE public.tvs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage TVs" ON public.tvs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_tvs_updated_at BEFORE UPDATE ON public.tvs FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.get_lounge_tvs(_lounge_id UUID)
RETURNS TABLE (
  id UUID, slot SMALLINT, display_name TEXT,
  selected_channel_id TEXT, selected_channel_name TEXT, selected_channel_logo TEXT,
  enabled BOOLEAN, status public.tv_status
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slot, t.display_name, t.selected_channel_id, t.selected_channel_name,
         t.selected_channel_logo, t.enabled, t.status
  FROM public.tvs t
  WHERE t.lounge_id = _lounge_id AND t.enabled = true
  ORDER BY t.slot
$$;
GRANT EXECUTE ON FUNCTION public.get_lounge_tvs(UUID) TO anon, authenticated;

-- CHANNEL CACHE
CREATE TABLE public.iptv_channels_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tv_id UUID NOT NULL REFERENCES public.tvs(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  logo_url TEXT,
  epg_id TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tv_id, channel_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.iptv_channels_cache TO authenticated;
GRANT ALL ON public.iptv_channels_cache TO service_role;
ALTER TABLE public.iptv_channels_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage channel cache" ON public.iptv_channels_cache FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_channels_cache_tv ON public.iptv_channels_cache (tv_id);

-- LOUNGE SESSIONS
CREATE TABLE public.lounge_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lounge_id UUID NOT NULL REFERENCES public.lounges(id) ON DELETE CASCADE,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status public.session_status NOT NULL DEFAULT 'preview',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.lounge_sessions TO authenticated;
GRANT ALL ON public.lounge_sessions TO service_role;
ALTER TABLE public.lounge_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own sessions" ON public.lounge_sessions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users create own sessions" ON public.lounge_sessions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins read all sessions" ON public.lounge_sessions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_lounge_sessions_user ON public.lounge_sessions (user_id);
CREATE INDEX idx_lounge_sessions_lounge ON public.lounge_sessions (lounge_id);

-- CHAT MESSAGES
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lounge_id UUID NOT NULL REFERENCES public.lounges(id) ON DELETE CASCADE,
  scope public.chat_scope NOT NULL DEFAULT 'all',
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read lounge chat" ON public.chat_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users post own messages" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE INDEX idx_chat_lounge_scope ON public.chat_messages (lounge_id, scope, created_at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- FRIENDSHIPS
CREATE TABLE public.friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO authenticated;
GRANT ALL ON public.friendships TO service_role;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own friendships" ON public.friendships FOR SELECT TO authenticated USING (requester_id = auth.uid() OR addressee_id = auth.uid());
CREATE POLICY "Users create own friendship requests" ON public.friendships FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid());
CREATE POLICY "Users update own friendships" ON public.friendships FOR UPDATE TO authenticated USING (requester_id = auth.uid() OR addressee_id = auth.uid()) WITH CHECK (requester_id = auth.uid() OR addressee_id = auth.uid());
CREATE POLICY "Users delete own friendships" ON public.friendships FOR DELETE TO authenticated USING (requester_id = auth.uid() OR addressee_id = auth.uid());
CREATE TRIGGER trg_friendships_updated_at BEFORE UPDATE ON public.friendships FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- DIRECT MESSAGES
CREATE TABLE public.direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);
GRANT SELECT, INSERT, UPDATE ON public.direct_messages TO authenticated;
GRANT ALL ON public.direct_messages TO service_role;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own DMs" ON public.direct_messages FOR SELECT TO authenticated USING (sender_id = auth.uid() OR recipient_id = auth.uid());
CREATE POLICY "Users send DMs" ON public.direct_messages FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());
CREATE POLICY "Recipients mark read" ON public.direct_messages FOR UPDATE TO authenticated USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());
CREATE INDEX idx_dm_thread ON public.direct_messages (sender_id, recipient_id, created_at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;

-- ADS
CREATE TABLE public.ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 15 CHECK (duration_sec > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads TO authenticated;
GRANT ALL ON public.ads TO service_role;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users see active ads" ON public.ads FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "Admins manage ads" ON public.ads FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_ads_updated_at BEFORE UPDATE ON public.ads FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- AD SCHEDULES
CREATE TABLE public.ad_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lounge_id UUID REFERENCES public.lounges(id) ON DELETE CASCADE,
  ad_ids UUID[] NOT NULL DEFAULT '{}',
  interval_minutes INTEGER NOT NULL DEFAULT 30 CHECK (interval_minutes >= 1),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_played_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_schedules TO authenticated;
GRANT ALL ON public.ad_schedules TO service_role;
ALTER TABLE public.ad_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users see active schedules" ON public.ad_schedules FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "Admins manage schedules" ON public.ad_schedules FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_ad_schedules_updated_at BEFORE UPDATE ON public.ad_schedules FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_schedules;

-- WALLET TRANSACTIONS
CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.wallet_tx_type NOT NULL,
  amount_cents INTEGER NOT NULL,
  lounge_session_id UUID REFERENCES public.lounge_sessions(id) ON DELETE SET NULL,
  memo TEXT,
  external_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own wallet txs" ON public.wallet_transactions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read all wallet txs" ON public.wallet_transactions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_wallet_tx_user ON public.wallet_transactions (user_id, created_at DESC);

-- STREAM HEALTH LOG
CREATE TABLE public.stream_health_log (
  id BIGSERIAL PRIMARY KEY,
  tv_id UUID NOT NULL REFERENCES public.tvs(id) ON DELETE CASCADE,
  status public.tv_status NOT NULL,
  latency_ms INTEGER,
  error TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.stream_health_log TO authenticated;
GRANT ALL ON public.stream_health_log TO service_role;
ALTER TABLE public.stream_health_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read stream health" ON public.stream_health_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_stream_health_tv ON public.stream_health_log (tv_id, checked_at DESC);

-- APP SETTINGS
CREATE TABLE public.app_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  default_entry_fee_cents INTEGER NOT NULL DEFAULT 500,
  default_free_preview_seconds INTEGER NOT NULL DEFAULT 120,
  pgx_wallet_api_base_url TEXT,
  allowed_iframe_parent_origins TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in reads app settings" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins update app settings" ON public.app_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
INSERT INTO public.app_settings (id) VALUES (true);
