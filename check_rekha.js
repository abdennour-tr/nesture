require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAll() {
  console.log("Fetching all users and children...");
  
  const { data: users } = await supabase.from('users').select('id, email, first_name, last_name, role');
  console.log("Users:", users?.map(u => `${u.first_name} ${u.last_name} (${u.email}) - ${u.role}`));

  const { data: children } = await supabase.from('children').select('id, first_name, parent_id');
  console.log("Children:", children?.map(c => `${c.first_name} (parent: ${c.parent_id})`));
}

checkAll();
