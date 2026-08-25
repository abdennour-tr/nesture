require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function createAccount() {
  console.log("Signing up...");
  const { data, error } = await supabase.auth.signUp({
    email: 'testfamily@nestureai.com',
    password: 'password123',
    options: {
      data: {
        first_name: 'Test',
        last_name: 'Family',
        role: 'parent'
      }
    }
  });
  console.log("Signup data:", JSON.stringify(data, null, 2));
  if (error) {
    console.error("Signup error:", error);
  }
}

createAccount();
