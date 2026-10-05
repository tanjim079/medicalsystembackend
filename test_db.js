import supabase from './src/config/supabase.js';

async function test() {
  const { data: profiles, error: pError } = await supabase.from('profiles').select('*').eq('role', 'patient');
  console.log("ALL PATIENT PROFILES:");
  console.log(profiles);
}
test();
