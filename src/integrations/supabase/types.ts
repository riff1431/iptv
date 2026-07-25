export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_schedules: {
        Row: {
          ad_ids: string[]
          created_at: string
          id: string
          interval_minutes: number
          is_active: boolean
          last_played_at: string | null
          lounge_id: string | null
          updated_at: string
        }
        Insert: {
          ad_ids?: string[]
          created_at?: string
          id?: string
          interval_minutes?: number
          is_active?: boolean
          last_played_at?: string | null
          lounge_id?: string | null
          updated_at?: string
        }
        Update: {
          ad_ids?: string[]
          created_at?: string
          id?: string
          interval_minutes?: number
          is_active?: boolean
          last_played_at?: string | null
          lounge_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_schedules_lounge_id_fkey"
            columns: ["lounge_id"]
            isOneToOne: false
            referencedRelation: "lounges"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          target_id: string | null
          target_table: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table?: string
        }
        Relationships: []
      }
      ads: {
        Row: {
          created_at: string
          duration_sec: number
          id: string
          is_active: boolean
          storage_path: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_sec?: number
          id?: string
          is_active?: boolean
          storage_path: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_sec?: number
          id?: string
          is_active?: boolean
          storage_path?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          admin_bootstrap_emails: string[]
          allowed_iframe_parent_origins: string[]
          default_entry_fee_cents: number
          default_free_preview_seconds: number
          id: boolean
          iptv_epg_url: string | null
          iptv_m3u_url: string | null
          iptv_provider_type: string
          iptv_xtream_password_encrypted: string | null
          iptv_xtream_server_url: string | null
          iptv_xtream_username: string | null
          pgx_wallet_api_base_url: string | null
          updated_at: string
        }
        Insert: {
          admin_bootstrap_emails?: string[]
          allowed_iframe_parent_origins?: string[]
          default_entry_fee_cents?: number
          default_free_preview_seconds?: number
          id?: boolean
          iptv_epg_url?: string | null
          iptv_m3u_url?: string | null
          iptv_provider_type?: string
          iptv_xtream_password_encrypted?: string | null
          iptv_xtream_server_url?: string | null
          iptv_xtream_username?: string | null
          pgx_wallet_api_base_url?: string | null
          updated_at?: string
        }
        Update: {
          admin_bootstrap_emails?: string[]
          allowed_iframe_parent_origins?: string[]
          default_entry_fee_cents?: number
          default_free_preview_seconds?: number
          id?: boolean
          iptv_epg_url?: string | null
          iptv_m3u_url?: string | null
          iptv_provider_type?: string
          iptv_xtream_password_encrypted?: string | null
          iptv_xtream_server_url?: string | null
          iptv_xtream_username?: string | null
          pgx_wallet_api_base_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          lounge_id: string | null
          match_id: string | null
          scope: Database["public"]["Enums"]["chat_scope"]
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          lounge_id?: string | null
          match_id?: string | null
          scope?: Database["public"]["Enums"]["chat_scope"]
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          lounge_id?: string | null
          match_id?: string | null
          scope?: Database["public"]["Enums"]["chat_scope"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_lounge_id_fkey"
            columns: ["lounge_id"]
            isOneToOne: false
            referencedRelation: "lounges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_messages: {
        Row: {
          attachments: Json
          body: string
          created_at: string
          id: string
          read_at: string | null
          recipient_id: string
          reply_to_id: string | null
          sender_id: string
        }
        Insert: {
          attachments?: Json
          body: string
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_id: string
          reply_to_id?: string | null
          sender_id: string
        }
        Update: {
          attachments?: Json
          body?: string
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_id?: string
          reply_to_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          status: string
          updated_at: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: string
          requester_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: string
          requester_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      iptv_channels_cache: {
        Row: {
          category: string | null
          channel_id: string
          epg_id: string | null
          fetched_at: string
          id: string
          logo_url: string | null
          name: string
          tv_id: string
        }
        Insert: {
          category?: string | null
          channel_id: string
          epg_id?: string | null
          fetched_at?: string
          id?: string
          logo_url?: string | null
          name: string
          tv_id: string
        }
        Update: {
          category?: string | null
          channel_id?: string
          epg_id?: string | null
          fetched_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          tv_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iptv_channels_cache_tv_id_fkey"
            columns: ["tv_id"]
            isOneToOne: false
            referencedRelation: "tvs"
            referencedColumns: ["id"]
          },
        ]
      }
      iptv_proxy_ip_blocks: {
        Row: {
          blocked_until: string
          created_at: string
          hits: number
          ip: string
          reason: string
          updated_at: string
        }
        Insert: {
          blocked_until: string
          created_at?: string
          hits?: number
          ip: string
          reason: string
          updated_at?: string
        }
        Update: {
          blocked_until?: string
          created_at?: string
          hits?: number
          ip?: string
          reason?: string
          updated_at?: string
        }
        Relationships: []
      }
      iptv_proxy_rejections: {
        Row: {
          created_at: string
          host: string | null
          id: string
          ip: string | null
          method: string
          raw_url_length: number
          reason: string
          request_id: string
          status: number
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          host?: string | null
          id?: string
          ip?: string | null
          method?: string
          raw_url_length?: number
          reason: string
          request_id: string
          status: number
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          host?: string | null
          id?: string
          ip?: string | null
          method?: string
          raw_url_length?: number
          reason?: string
          request_id?: string
          status?: number
          user_agent?: string | null
        }
        Relationships: []
      }
      lounge_sessions: {
        Row: {
          amount_cents: number
          created_at: string
          entered_at: string
          expires_at: string
          id: string
          lounge_id: string
          paid_at: string | null
          status: Database["public"]["Enums"]["session_status"]
          user_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          entered_at?: string
          expires_at: string
          id?: string
          lounge_id: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          entered_at?: string
          expires_at?: string
          id?: string
          lounge_id?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lounge_sessions_lounge_id_fkey"
            columns: ["lounge_id"]
            isOneToOne: false
            referencedRelation: "lounges"
            referencedColumns: ["id"]
          },
        ]
      }
      lounges: {
        Row: {
          cover_image_url: string | null
          created_at: string
          entry_fee_cents: number
          free_preview_seconds: number
          id: string
          is_active: boolean
          is_featured: boolean
          is_private: boolean
          match_accent_away: string | null
          match_accent_home: string | null
          match_away_label: string | null
          match_away_score: number
          match_clock_label: string | null
          match_home_label: string | null
          match_home_score: number
          match_period_label: string | null
          match_sport: string | null
          match_starts_at: string | null
          match_status: string
          match_thumbnail_url: string | null
          match_title: string | null
          name: string
          owner_user_id: string | null
          slug: string
          sort_order: number
          tagline: string | null
          updated_at: string
          vibe: string | null
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          entry_fee_cents?: number
          free_preview_seconds?: number
          id?: string
          is_active?: boolean
          is_featured?: boolean
          is_private?: boolean
          match_accent_away?: string | null
          match_accent_home?: string | null
          match_away_label?: string | null
          match_away_score?: number
          match_clock_label?: string | null
          match_home_label?: string | null
          match_home_score?: number
          match_period_label?: string | null
          match_sport?: string | null
          match_starts_at?: string | null
          match_status?: string
          match_thumbnail_url?: string | null
          match_title?: string | null
          name: string
          owner_user_id?: string | null
          slug: string
          sort_order?: number
          tagline?: string | null
          updated_at?: string
          vibe?: string | null
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          entry_fee_cents?: number
          free_preview_seconds?: number
          id?: string
          is_active?: boolean
          is_featured?: boolean
          is_private?: boolean
          match_accent_away?: string | null
          match_accent_home?: string | null
          match_away_label?: string | null
          match_away_score?: number
          match_clock_label?: string | null
          match_home_label?: string | null
          match_home_score?: number
          match_period_label?: string | null
          match_sport?: string | null
          match_starts_at?: string | null
          match_status?: string
          match_thumbnail_url?: string | null
          match_title?: string | null
          name?: string
          owner_user_id?: string | null
          slug?: string
          sort_order?: number
          tagline?: string | null
          updated_at?: string
          vibe?: string | null
        }
        Relationships: []
      }
      match_sessions: {
        Row: {
          amount_cents: number
          created_at: string
          entered_at: string
          expires_at: string
          id: string
          match_id: string
          paid_at: string | null
          status: Database["public"]["Enums"]["session_status"]
          user_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          entered_at?: string
          expires_at: string
          id?: string
          match_id: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          entered_at?: string
          expires_at?: string
          id?: string
          match_id?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_sessions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_slots: {
        Row: {
          channel_id: string | null
          channel_logo: string | null
          channel_name: string | null
          created_at: string
          enabled: boolean
          id: string
          match_id: string
          slot: number
          updated_at: string
        }
        Insert: {
          channel_id?: string | null
          channel_logo?: string | null
          channel_name?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          match_id: string
          slot: number
          updated_at?: string
        }
        Update: {
          channel_id?: string | null
          channel_logo?: string | null
          channel_name?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          match_id?: string
          slot?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_slots_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          accent_away: string | null
          accent_home: string | null
          away_label: string | null
          away_score: number
          clock_label: string | null
          created_at: string
          entry_fee_cents: number
          free_preview_seconds: number
          home_label: string | null
          home_score: number
          id: string
          is_active: boolean
          owner_id: string | null
          period_label: string | null
          slot_count: number
          sort_order: number
          sport: string | null
          starts_at: string | null
          status: string
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          accent_away?: string | null
          accent_home?: string | null
          away_label?: string | null
          away_score?: number
          clock_label?: string | null
          created_at?: string
          entry_fee_cents?: number
          free_preview_seconds?: number
          home_label?: string | null
          home_score?: number
          id?: string
          is_active?: boolean
          owner_id?: string | null
          period_label?: string | null
          slot_count?: number
          sort_order?: number
          sport?: string | null
          starts_at?: string | null
          status?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          accent_away?: string | null
          accent_home?: string | null
          away_label?: string | null
          away_score?: number
          clock_label?: string | null
          created_at?: string
          entry_fee_cents?: number
          free_preview_seconds?: number
          home_label?: string | null
          home_score?: number
          id?: string
          is_active?: boolean
          owner_id?: string | null
          period_label?: string | null
          slot_count?: number
          sort_order?: number
          sport?: string | null
          starts_at?: string | null
          status?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          code: string
          config: Json
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          icon: string | null
          id: string
          instructions: string | null
          kind: Database["public"]["Enums"]["topup_method"]
          label: string
          reference_placeholder: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          icon?: string | null
          id?: string
          instructions?: string | null
          kind?: Database["public"]["Enums"]["topup_method"]
          label: string
          reference_placeholder?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          icon?: string | null
          id?: string
          instructions?: string | null
          kind?: Database["public"]["Enums"]["topup_method"]
          label?: string
          reference_placeholder?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      quick_dares: {
        Row: {
          created_at: string
          icon: string
          id: string
          is_active: boolean
          label: string
          price_cents: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          icon?: string
          id?: string
          is_active?: boolean
          label: string
          price_cents: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          icon?: string
          id?: string
          is_active?: boolean
          label?: string
          price_cents?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      seg_upstream_failures: {
        Row: {
          attempts: number
          duration_ms: number | null
          id: number
          kind: string
          message: string | null
          occurred_at: string
          reason: string
          status: number | null
          succeeded: boolean
          tv_id: string
          upstream_host: string | null
        }
        Insert: {
          attempts?: number
          duration_ms?: number | null
          id?: number
          kind: string
          message?: string | null
          occurred_at?: string
          reason: string
          status?: number | null
          succeeded?: boolean
          tv_id: string
          upstream_host?: string | null
        }
        Update: {
          attempts?: number
          duration_ms?: number | null
          id?: number
          kind?: string
          message?: string | null
          occurred_at?: string
          reason?: string
          status?: number | null
          succeeded?: boolean
          tv_id?: string
          upstream_host?: string | null
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          favicon_url: string | null
          id: boolean
          logo_url: string | null
          meta_description: string
          meta_title: string
          og_image_url: string | null
          site_name: string
          twitter_handle: string | null
          updated_at: string
        }
        Insert: {
          favicon_url?: string | null
          id?: boolean
          logo_url?: string | null
          meta_description?: string
          meta_title?: string
          og_image_url?: string | null
          site_name?: string
          twitter_handle?: string | null
          updated_at?: string
        }
        Update: {
          favicon_url?: string | null
          id?: boolean
          logo_url?: string | null
          meta_description?: string
          meta_title?: string
          og_image_url?: string | null
          site_name?: string
          twitter_handle?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      stream_health_log: {
        Row: {
          checked_at: string
          error: string | null
          id: number
          latency_ms: number | null
          status: Database["public"]["Enums"]["tv_status"]
          tv_id: string
        }
        Insert: {
          checked_at?: string
          error?: string | null
          id?: number
          latency_ms?: number | null
          status: Database["public"]["Enums"]["tv_status"]
          tv_id: string
        }
        Update: {
          checked_at?: string
          error?: string | null
          id?: number
          latency_ms?: number | null
          status?: Database["public"]["Enums"]["tv_status"]
          tv_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stream_health_log_tv_id_fkey"
            columns: ["tv_id"]
            isOneToOne: false
            referencedRelation: "tvs"
            referencedColumns: ["id"]
          },
        ]
      }
      topup_requests: {
        Row: {
          admin_note: string | null
          amount_cents: number
          created_at: string
          id: string
          method: Database["public"]["Enums"]["topup_method"]
          payment_method_id: string | null
          processed_at: string | null
          processed_by: string | null
          proof_path: string | null
          reference: string | null
          status: Database["public"]["Enums"]["topup_status"]
          updated_at: string
          user_id: string
          user_note: string | null
        }
        Insert: {
          admin_note?: string | null
          amount_cents: number
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["topup_method"]
          payment_method_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          proof_path?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["topup_status"]
          updated_at?: string
          user_id: string
          user_note?: string | null
        }
        Update: {
          admin_note?: string | null
          amount_cents?: number
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["topup_method"]
          payment_method_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          proof_path?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["topup_status"]
          updated_at?: string
          user_id?: string
          user_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "topup_requests_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      tv_stream_sessions: {
        Row: {
          channel_id: string | null
          created_at: string
          last_error: string | null
          last_playlist_fetch_at: string | null
          started_at: string | null
          status: string
          stopped_at: string | null
          tv_id: string
          updated_at: string
        }
        Insert: {
          channel_id?: string | null
          created_at?: string
          last_error?: string | null
          last_playlist_fetch_at?: string | null
          started_at?: string | null
          status?: string
          stopped_at?: string | null
          tv_id: string
          updated_at?: string
        }
        Update: {
          channel_id?: string | null
          created_at?: string
          last_error?: string | null
          last_playlist_fetch_at?: string | null
          started_at?: string | null
          status?: string
          stopped_at?: string | null
          tv_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tv_stream_sessions_tv_id_fkey"
            columns: ["tv_id"]
            isOneToOne: true
            referencedRelation: "tvs"
            referencedColumns: ["id"]
          },
        ]
      }
      tvs: {
        Row: {
          accent_away: string | null
          accent_home: string | null
          away_label: string | null
          away_score: number
          clock_label: string | null
          connection_type: Database["public"]["Enums"]["iptv_conn_type"]
          created_at: string
          current_stream_url: string | null
          display_name: string | null
          enabled: boolean
          home_label: string | null
          home_score: number
          id: string
          last_checked_at: string | null
          last_status_message: string | null
          lounge_id: string
          matchup: string | null
          password: string | null
          period_label: string | null
          provider_name: string | null
          selected_channel_id: string | null
          selected_channel_logo: string | null
          selected_channel_name: string | null
          server_url: string | null
          slot: number
          sport: string | null
          status: Database["public"]["Enums"]["tv_status"]
          updated_at: string
          username: string | null
        }
        Insert: {
          accent_away?: string | null
          accent_home?: string | null
          away_label?: string | null
          away_score?: number
          clock_label?: string | null
          connection_type?: Database["public"]["Enums"]["iptv_conn_type"]
          created_at?: string
          current_stream_url?: string | null
          display_name?: string | null
          enabled?: boolean
          home_label?: string | null
          home_score?: number
          id?: string
          last_checked_at?: string | null
          last_status_message?: string | null
          lounge_id: string
          matchup?: string | null
          password?: string | null
          period_label?: string | null
          provider_name?: string | null
          selected_channel_id?: string | null
          selected_channel_logo?: string | null
          selected_channel_name?: string | null
          server_url?: string | null
          slot: number
          sport?: string | null
          status?: Database["public"]["Enums"]["tv_status"]
          updated_at?: string
          username?: string | null
        }
        Update: {
          accent_away?: string | null
          accent_home?: string | null
          away_label?: string | null
          away_score?: number
          clock_label?: string | null
          connection_type?: Database["public"]["Enums"]["iptv_conn_type"]
          created_at?: string
          current_stream_url?: string | null
          display_name?: string | null
          enabled?: boolean
          home_label?: string | null
          home_score?: number
          id?: string
          last_checked_at?: string | null
          last_status_message?: string | null
          lounge_id?: string
          matchup?: string | null
          password?: string | null
          period_label?: string | null
          provider_name?: string | null
          selected_channel_id?: string | null
          selected_channel_logo?: string | null
          selected_channel_name?: string | null
          server_url?: string | null
          slot?: number
          sport?: string | null
          status?: Database["public"]["Enums"]["tv_status"]
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tvs_lounge_id_fkey"
            columns: ["lounge_id"]
            isOneToOne: false
            referencedRelation: "lounges"
            referencedColumns: ["id"]
          },
        ]
      }
      user_match_slot_prefs: {
        Row: {
          match_id: string
          slot: number
          updated_at: string
          user_id: string
        }
        Insert: {
          match_id: string
          slot: number
          updated_at?: string
          user_id: string
        }
        Update: {
          match_id?: string
          slot?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_match_slot_prefs_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notification_prefs: {
        Row: {
          created_at: string
          prefs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          prefs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          prefs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount_cents: number
          chat_message_id: string | null
          created_at: string
          direct_message_id: string | null
          external_ref: string | null
          id: string
          lounge_id: string | null
          lounge_session_id: string | null
          match_id: string | null
          match_session_id: string | null
          memo: string | null
          recipient_user_id: string | null
          type: Database["public"]["Enums"]["wallet_tx_type"]
          user_id: string
        }
        Insert: {
          amount_cents: number
          chat_message_id?: string | null
          created_at?: string
          direct_message_id?: string | null
          external_ref?: string | null
          id?: string
          lounge_id?: string | null
          lounge_session_id?: string | null
          match_id?: string | null
          match_session_id?: string | null
          memo?: string | null
          recipient_user_id?: string | null
          type: Database["public"]["Enums"]["wallet_tx_type"]
          user_id: string
        }
        Update: {
          amount_cents?: number
          chat_message_id?: string | null
          created_at?: string
          direct_message_id?: string | null
          external_ref?: string | null
          id?: string
          lounge_id?: string | null
          lounge_session_id?: string | null
          match_id?: string | null
          match_session_id?: string | null
          memo?: string | null
          recipient_user_id?: string | null
          type?: Database["public"]["Enums"]["wallet_tx_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_chat_message_id_fkey"
            columns: ["chat_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_direct_message_id_fkey"
            columns: ["direct_message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_lounge_id_fkey"
            columns: ["lounge_id"]
            isOneToOne: false
            referencedRelation: "lounges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_lounge_session_id_fkey"
            columns: ["lounge_session_id"]
            isOneToOne: false
            referencedRelation: "lounge_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_match_session_id_fkey"
            columns: ["match_session_id"]
            isOneToOne: false
            referencedRelation: "match_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawal_requests: {
        Row: {
          admin_note: string | null
          amount_cents: number
          created_at: string
          destination: string
          id: string
          method: Database["public"]["Enums"]["withdrawal_method"]
          processed_at: string | null
          processed_by: string | null
          status: Database["public"]["Enums"]["withdrawal_status"]
          updated_at: string
          user_id: string
          user_note: string | null
        }
        Insert: {
          admin_note?: string | null
          amount_cents: number
          created_at?: string
          destination: string
          id?: string
          method: Database["public"]["Enums"]["withdrawal_method"]
          processed_at?: string | null
          processed_by?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
          user_id: string
          user_note?: string | null
        }
        Update: {
          admin_note?: string | null
          amount_cents?: number
          created_at?: string
          destination?: string
          id?: string
          method?: Database["public"]["Enums"]["withdrawal_method"]
          processed_at?: string | null
          processed_by?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
          user_id?: string
          user_note?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_dashboard_stats: {
        Args: never
        Returns: {
          active_users_24h: number
          active_users_prev_24h: number
          live_lobbies_now: number
          live_lobbies_prev_24h: number
          lobbies_today: number
          lobbies_yesterday: number
          revenue_today_cents: number
          revenue_yesterday_cents: number
          users_today: number
          users_yesterday: number
        }[]
      }
      admin_match_viewer_counts: {
        Args: { _match_ids: string[] }
        Returns: {
          match_id: string
          viewers_24h: number
        }[]
      }
      approve_topup_request: {
        Args: { _admin_note?: string; _id: string }
        Returns: string
      }
      claim_admin_if_allowed: { Args: never; Returns: boolean }
      get_lounge_tvs: {
        Args: { _lounge_id: string }
        Returns: {
          display_name: string
          enabled: boolean
          id: string
          selected_channel_id: string
          selected_channel_logo: string
          selected_channel_name: string
          slot: number
          status: Database["public"]["Enums"]["tv_status"]
        }[]
      }
      get_public_iptv_provider: {
        Args: never
        Returns: {
          epg_url: string
          m3u_url: string
          provider_type: string
          xtream_server_url: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      promote_scheduled_matches: { Args: never; Returns: number }
      reject_topup_request: {
        Args: { _admin_note?: string; _id: string }
        Returns: undefined
      }
      send_tip: {
        Args: {
          _amount_cents: number
          _chat_message_id?: string
          _direct_message_id?: string
          _lounge_id?: string
          _match_id?: string
          _memo?: string
          _recipient_user_id: string
        }
        Returns: {
          credit_id: string
          debit_id: string
        }[]
      }
      swap_match_slots: {
        Args: { _match_id: string; _slot_a: number; _slot_b: number }
        Returns: undefined
      }
      swap_tv_slots: {
        Args: { _lounge_id: string; _slot_a: number; _slot_b: number }
        Returns: undefined
      }
      wallet_balance_cents: { Args: { _user_id: string }; Returns: number }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      chat_scope: "all" | "tv1" | "tv2" | "tv3" | "tv4"
      iptv_conn_type: "xtream" | "m3u" | "hls"
      notification_kind: "system" | "message" | "lounge" | "wallet" | "admin"
      session_status: "preview" | "paid" | "expired"
      topup_method: "bank_transfer" | "mobile_money" | "cash" | "other"
      topup_status: "pending" | "approved" | "rejected" | "cancelled"
      tv_status: "offline" | "online" | "error" | "unconfigured"
      wallet_tx_type:
        | "debit_lounge_entry"
        | "refund"
        | "credit"
        | "debit_tip"
        | "debit_match_entry"
      withdrawal_method: "paypal" | "bank_transfer" | "crypto"
      withdrawal_status:
        | "pending"
        | "approved"
        | "rejected"
        | "paid"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      chat_scope: ["all", "tv1", "tv2", "tv3", "tv4"],
      iptv_conn_type: ["xtream", "m3u", "hls"],
      notification_kind: ["system", "message", "lounge", "wallet", "admin"],
      session_status: ["preview", "paid", "expired"],
      topup_method: ["bank_transfer", "mobile_money", "cash", "other"],
      topup_status: ["pending", "approved", "rejected", "cancelled"],
      tv_status: ["offline", "online", "error", "unconfigured"],
      wallet_tx_type: [
        "debit_lounge_entry",
        "refund",
        "credit",
        "debit_tip",
        "debit_match_entry",
      ],
      withdrawal_method: ["paypal", "bank_transfer", "crypto"],
      withdrawal_status: [
        "pending",
        "approved",
        "rejected",
        "paid",
        "cancelled",
      ],
    },
  },
} as const
