import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import ws from 'ws';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: ws } }
);

const rawData = `Name	Designation	Department	Email	Phone
Dr. Md. Kamal Hosain	Professor	ETE	kamaleteruet@gmail.com	01716-130151
Dr Md Munjure Mowla	Professor	ETE	rimonece@gmail.com	01771-930245
Dr. Mst. Fateha Samad	Professor	ETE	fatehasamad@ete.ruet.ac.bd	01796-382971
Dr. Shah Ariful Hoque Chowdhury	Professor	ETE	arif.1968.ruet@gmail.com	01306-495966
Dr. Tushar Kanti Roy	Associate Professor	ETE	tkroy@ete.ruet.ac.bd	01314-210424
Dr. Md Rabiul Hasan	Associate Professor	ETE	ruetrabu@gmail.com	01723-272314
Jannatul Robaiat Mou	Assistant Professor	ETE	jannatulruet@gmail.com	01911-738780
Sham Datto	Assistant Professor	ETE	shamdatto@ete.ruet.ac.bd	01711-879056
Md. Aslam Mollah	Assistant Professor	ETE	ruet10aslam@gmail.com	01738-643809
A. S. M. Badrudduza	Assistant Professor	ETE	asmb.kanon@gmail.com	01927-961896
Dr. Md. Yeakub Ali	Assistant Professor	ETE	yeakub.ruet08@gmail.com	01722-923669
Md. Rakib Hossain	Assistant Professor	ETE	rakib.hossain@ete.ruet.ac.bd	01743-293555
Shuvra Prokash Biswas	Assistant Professor	ETE	spbiswas@ete.ruet.ac.bd	01747-568339
Hasan Sarker	Assistant Professor	ETE	hasan.ruet.ete@gmail.com	01612-707075
Farzana Akter	Assistant Professor	ETE	farzanaeteruet@gmail.com	01791-282222
Md Abu Ismail Siddique	Assistant Professor	ETE	saif101303@gmail.com	01521-300294
Sharaf Tasnim	Assistant Professor	ETE	sharaftasnim786@gmail.com	01789-223600
Md. Mahmudul Hasan	Lecturer	ETE	mahmudul@ete.ruet.ac.bd	01710-132822
Md. Rakibul Islam	Lecturer	ETE	rakibulislam@ete.ruet.ac.bd	01304-172487
Md. Tarek Hassan	Lecturer	ETE	tarekruet024@gmail.com	01767-266480
Mohammed Nazmul Islam Nahin	Lecturer	ETE	nahinete.ruet@gmail.com	01876-519534
Rubaeat Ahammed	Lecturer	ETE	rubaeat.ahammed@ete.ruet.ac.bd	01782-359987
Rifa Tabassum Mim	Lecturer	ETE	rifa.mim@ete.ruet.ac.bd	01754-320604`;

const rows = rawData.split('\n').slice(1);
const teachers = rows.map(row => {
  const [name, designation, department, email, phone] = row.split('\t');
  return {
    name: name.trim(),
    designation: designation.trim(),
    department: department.trim(),
    email: email.trim(),
    phone: phone.trim()
  };
}).filter(t => t.email);

const seedTeachers = async () => {
  for (const teacher of teachers) {
    console.log(`Processing ${teacher.name}...`);
    
    // Default password for teachers
    const password = `ruetteacher123`;

    try {
      // 1. Create auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: teacher.email,
        password: password,
        email_confirm: true,
        user_metadata: { name: teacher.name, role: 'teacher' }
      });

      if (authError) {
        if (JSON.stringify(authError).includes('already exists')) {
             console.log(`User ${teacher.email} already exists, skipping auth creation.`);
        } else {
             console.error(`Failed to create auth user for ${teacher.email}:`, JSON.stringify(authError));
             continue;
        }
      }

      // If existing user, we need their ID. For now we assume fresh creation or we could fetch it.
      let userId = authData?.user?.id;
      
      if (!userId) {
          const { data: existingUsers, error: fetchError } = await supabase.auth.admin.listUsers();
          if (!fetchError && existingUsers) {
              const existingUser = existingUsers.users.find(u => u.email === teacher.email);
              if (existingUser) userId = existingUser.id;
          }
      }

      if (!userId) continue;

      // 2. Insert into teachers table
      const { error: teacherError } = await supabase
        .from('teachers')
        .upsert([{
          id: userId,
          name: teacher.name,
          designation: teacher.designation,
          department: teacher.department,
          phone: teacher.phone,
          email: teacher.email
        }], { onConflict: 'id' });

      if (teacherError) {
        console.error(`Failed to insert teacher details for ${teacher.name}:`, teacherError.message);
      } else {
        console.log(`Successfully seeded teacher ${teacher.name}`);
      }
    } catch (err) {
      console.error('Unexpected error:', err.message);
    }
  }
  
  console.log('Seeding complete!');
};

seedTeachers();
