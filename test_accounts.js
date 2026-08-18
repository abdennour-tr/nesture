require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const accountsToTest = [
  { email: 'fake.email.does.not.exist@nestureai.com', password: 'password123', role: 'Fake' },
  { email: 'ot.test@nestureai.com', password: 'password123', role: 'OT' },
  { email: 'parent.test@nestureai.com', password: 'password123', role: 'Parent' },
  { email: 'enfant_test', password: 'password123_learner_suffix', role: 'Enfant' }
];

async function testAccounts() {
  console.log('Testing Supabase Test Accounts...\n');
  
  for (const account of accountsToTest) {
    console.log(`Testing ${account.role} account (${account.email})...`);
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });
    
    if (error) {
      console.error(`❌ Failed to login to ${account.role} account: ${error.message}`);
    } else {
      console.log(`✅ Successfully logged in as ${account.role}! User ID: ${data.user.id}`);
      
      // Let's also fetch their profile to ensure it was created correctly
      const { data: profileData, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user.id)
        .single();
        
      if (profileError) {
        console.warn(`   ⚠️ Warning: Could not fetch public profile: ${profileError.message}`);
      } else {
        console.log(`   📝 Profile verified: ${profileData.first_name} ${profileData.last_name} (${profileData.role})`);
      }
    }
    console.log('---');
    
    // Sign out to not mix sessions (though Node client manages it per instance usually, good practice)
    await supabase.auth.signOut();
  }
}

testAccounts();
