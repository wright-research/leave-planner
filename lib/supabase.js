// Supabase client. URL and anon key live in config.js (gitignored).
// In DEMO_MODE the client is null and store.js falls back to fixtures.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_MODE } from '../config.js';

export { DEMO_MODE };

export const supabase = DEMO_MODE ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
