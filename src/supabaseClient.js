import { createClient } from '@supabase/supabase-js'

const supabaseUrl = "https://qksgiqevtapaqafojnku.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrc2dpcWV2dGFwYXFhZm9qbmt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3NTgwNjksImV4cCI6MjA4MDMzNDA2OX0.OmaWzZX62zaby4iaseFVaing9Iv5R60TPTjmENEbkkU";

export const supabase = createClient(supabaseUrl, supabaseKey);
