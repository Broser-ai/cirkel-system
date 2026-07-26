-- 015_push_subscriptions.sql
--
-- Cirkel — Modul: WebPush subscription registrering.
--
-- Understøtter POST /api/notifications/subscribe. Én række pr.
-- (firebase_uid, endpoint) — samme device der subscriber igen opdaterer
-- p256dh/auth/user_agent i stedet for at duplikere.
--
-- Sikkerhed:
--   • RLS enabled.
--   • KUN service-role må skrive/læse (denne tabel indeholder push-endpoints
--     som er følsomme delivery-URLs). Klienten skal ALDRIG læse direkte —
--     alt går via server-side /api/notifications/* endpoints.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid   text        NOT NULL,
  endpoint       text        NOT NULL,
  p256dh         text        NOT NULL,
  auth           text        NOT NULL,
  user_agent     text        NULL,
  uid_verified   boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_len_chk
    CHECK (char_length(endpoint) BETWEEN 1 AND 2048),
  CONSTRAINT push_subscriptions_p256dh_len_chk
    CHECK (char_length(p256dh) BETWEEN 1 AND 256),
  CONSTRAINT push_subscriptions_auth_len_chk
    CHECK (char_length(auth) BETWEEN 1 AND 128),
  CONSTRAINT push_subscriptions_user_agent_len_chk
    CHECK (user_agent IS NULL OR char_length(user_agent) BETWEEN 1 AND 512),
  CONSTRAINT push_subscriptions_uid_len_chk
    CHECK (char_length(firebase_uid) BETWEEN 1 AND 128)
);

-- UPSERT-key: samme device kan kun være subscribed én gang pr. bruger.
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_uid_endpoint_uniq
  ON public.push_subscriptions (firebase_uid, endpoint);

-- Query-hjælpere: opslag pr. bruger + oprydning af gamle rækker.
CREATE INDEX IF NOT EXISTS push_subscriptions_uid_idx
  ON public.push_subscriptions (firebase_uid);
CREATE INDEX IF NOT EXISTS push_subscriptions_updated_idx
  ON public.push_subscriptions (updated_at DESC);

-- RLS: service-role bypasser altid RLS, men vi enforce'r at INGEN anon/authed
-- rolle får direkte adgang. Alt læsning/skrivning går via server-endpoints.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_no_client_read
  ON public.push_subscriptions;
CREATE POLICY push_subscriptions_no_client_read
  ON public.push_subscriptions
  FOR SELECT
  TO anon, authenticated
  USING (false);

DROP POLICY IF EXISTS push_subscriptions_no_client_write
  ON public.push_subscriptions;
CREATE POLICY push_subscriptions_no_client_write
  ON public.push_subscriptions
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Auto-opdater updated_at ved skrivning.
CREATE OR REPLACE FUNCTION public.push_subscriptions_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_subscriptions_touch_updated_at_trg
  ON public.push_subscriptions;
CREATE TRIGGER push_subscriptions_touch_updated_at_trg
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.push_subscriptions_touch_updated_at();

COMMENT ON TABLE public.push_subscriptions IS
  'WebPush subscriptions (VAPID). Skrives via /api/notifications/subscribe. Server-only RLS.';
COMMENT ON COLUMN public.push_subscriptions.uid_verified IS
  'True hvis Firebase ID-token blev cryptografisk verificeret ved registrering (F3.8).';
