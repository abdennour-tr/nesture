require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);

async function check() {
  const pId = '99b68a18-462d-4bff-a035-5dac390f04bf';
  const { count: lCount, error: errL } = await supabase.from('learners').select('*', { count: 'exact', head: true }).eq('parent_id', pId);
  const { count: cCount, error: errC } = await supabase.from('children').select('*', { count: 'exact', head: true }).eq('parent_id', pId);
  console.log(`Learners: ${lCount} (Err: ${errL?.message}), Children: ${cCount} (Err: ${errC?.message})`);
}
check();
