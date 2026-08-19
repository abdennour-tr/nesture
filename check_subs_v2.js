import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSub() {
  const { data, error } = await supabase.from('subscriptions').select('*').order('created_at', { ascending: false }).limit(5);
  console.log("Subscriptions:", JSON.stringify(data, null, 2));
  if (error) console.error("Error:", error);
}

checkSub();
