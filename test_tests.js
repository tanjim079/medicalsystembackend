import supabase from './src/config/supabase.js';
async function test() {
  const { data, error } = await supabase.from('medical_tests').select('*');
  console.log(data);
}
test();
