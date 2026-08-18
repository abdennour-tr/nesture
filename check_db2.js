require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);
async function check() {
  const parentId = '99b68a18-462d-4bff-a035-5dac390f04bf';
  const { data, error } = await supabase.from('subscriptions').select('*').eq('parent_id', parentId).eq('status', 'active').maybeSingle();
  console.log("Data:", data);
  console.log("Error:", error);
}
check();
