import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase.from('exercises').select('*');
  if (error) {
    console.error('Error fetching:', error);
    return;
  }
  
  const simulated = data.filter(e => e.id.startsWith('ex-'));
  console.log(`Found ${simulated.length} simulated exercises out of ${data.length} total.`);
  
  if (simulated.length === 0) return;

  const ids = simulated.map(e => e.id);
  
  console.log('Deleting related prescriptions...');
  const { error: pError } = await supabase.from('prescriptions').delete().in('exercise_id', ids);
  if (pError) console.error('Error deleting related prescriptions:', pError);
  
  console.log('Deleting exercises...');
  const { error: delError } = await supabase.from('exercises').delete().in('id', ids);
  if (delError) {
    console.error('Error deleting exercises:', delError);
  } else {
    console.log('Successfully deleted all simulated exercises!');
  }
}

run();
