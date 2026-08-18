import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase.from('exercises').select('*');
  if (error) {
    console.error('Error fetching exercises:', error);
    return;
  }
  
  console.log(`Total exercises in DB: ${data.length}`);
  data.forEach(ex => {
    console.log(`- ID: ${ex.id} | Name: ${ex.name} | Video: ${ex.video_url || 'NONE'}`);
  });
}

run();
