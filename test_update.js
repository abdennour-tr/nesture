import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);

async function run() {
  // Try to update the exercise
  const exerciseId = 'c3d337d3-532e-4a93-9813-7017edbb53c8'; // ID of the 'test' exercise
  const { data, error } = await supabase
    .from('exercises')
    .update({ name: 'test updated' })
    .eq('id', exerciseId)
    .select()
    .single();

  if (error) {
    console.error('Update failed with error:', JSON.stringify(error, null, 2));
  } else {
    console.log('Update succeeded:', data);
  }
}

run();
