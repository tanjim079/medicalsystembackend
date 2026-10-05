import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import ws from 'ws';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: ws } }
);

const rawData = `Roll	Name	Reg. No	Dept	Student Email	DOB (Age)	Blood Group	Student Phone	Guardian Name	Guardian Phone
2204001	FATIN AWSAF AMIN	725	ETE	2204001@student.ruet.ac.bd	13-04-2005 (21)	O (+ve)	01770-917975	FAHIMA KHANAM	01715-772645
2204002	SHEIKH TANJIM AHMED	726	ETE	2204002@student.ruet.ac.bd	09-04-2004 (22)	O (+ve)	01783-854832	Md. Salahuddin	01716-390038
2204003	MD. MAHE ALAM	727	ETE	2204003@student.ruet.ac.bd	26-02-2004 (22)	O (+ve)	01575-438174	MST. MABIA BEGUM	01332-323622
2204004	AFIFA TASNIM HAQUE	728	ETE	2204004@student.ruet.ac.bd	13-11-2004 (21)	A(+ve)	01779-934907	Md. Emdadul Haque	01711-022062
2204005	MOST. NAFISA TABASSUM	729	ETE	2204005@student.ruet.ac.bd	12-04-2005 (21)	O (+ve)	01744-240214	Most.Romena Naznin	01716-030423
2204006	MD. IFTAKER RAHAMAN RADIT	730	ETE	2204006@student.ruet.ac.bd	29-09-2004 (22)	A(+ve)	01740-059532	Md. aminur Rahman	01737-526732
2204007	TALHA MAHMUD SIAM KHAN	731	ETE	2204007@student.ruet.ac.bd	20-04-2004 (22)	A(+ve)	01742-093008	Abdul Kader Khan	01761-665392
2204008	MD. MAHIR SHAHRIAR	732	ETE	2204008@student.ruet.ac.bd	21-02-2004 (22)	A(+ve)	0177-3038544	Nargis Morsheda	01718-014508
2204009	FARHAN HASIN FAHIM	733	ETE	2204009@student.ruet.ac.bd	22-04-2004 (22)	A(+ve)	0176-7207999	Md. Fakhrul Hasan	0171-2929571
2204010	MD. RAKIB HASAN	734	ETE	2204010@student.ruet.ac.bd	10-11-2004 (21)	AB(+ve)	01999-797442	Anwara Begum	01718-744509
2204011	MD. LOHAN ALI	735	ETE	2204011@student.ruet.ac.bd	20-02-2004 (22)	AB(+ve)	01315-140078	Md. Shohidul Islam	01723-278124
2204012	BHISMODEV SAHA DHAIRJO	736	ETE	2204012@student.ruet.ac.bd	06-12-2004 (21)	B(+ve)	01709-441586	HIMANGSHU KUMER SAHA	01834-043266
2204013	MAHATHIR MOHAMMAD SIYAM	737	ETE	2204013@student.ruet.ac.bd	31-10-2003 (22)	B(+ve)	01331-531428	Md Sorowar Hossain Talukder	018766-74688
2204014	AJRAF FAHIM	738	ETE	2204014@student.ruet.ac.bd	24-04-2004 (22)	B(+ve)	01624-481044	MD. MOIDUL ISLAM	01721-742142
2204015	MD. SAWGATUL ALAM	739	ETE	2204015@student.ruet.ac.bd	27-10-2004 (21)	A(+ve)	01716-538151	MD. SHAMSUL ALAM	01713-793862
2204016	MD. TARIK JAMIL	740	ETE	2204016@student.ruet.ac.bd	07-08-2004 (22)	O (+ve)	01572-092326	Md. Joynal Abedin Talukder	01712-692556
2204017	OBAIDUL ISLAM AONTOR	741	ETE	2204017@student.ruet.ac.bd	30-06-2004 (22)	AB(+ve)	01966-901568	ALTAF HOSSAIN	01670-953387
2204018	SAMIHA TABASSUM ANIKA	742	ETE	2204018@student.ruet.ac.bd	03-12-2005 (20)	A(+ve)	01817-868835	MD. Sharafat Hossain	01767-108055
2204019	MD. MURADUZZAMAN SIFAT	743	ETE	2204019@student.ruet.ac.bd	10-05-2005 (21)	B(+ve)	01879-844511	MD MOJAHARUL ISLAM	01734-159153
2204020	MD ATIQUE ASHFAK ARIB	744	ETE	2204020@student.ruet.ac.bd	17-12-2004 (21)	A(+ve)	01841-006510	MD ASHRAF ALI	01713-118049
2204021	ANANNA DEB	745	ETE	2204021@student.ruet.ac.bd	17-01-2004 (22)	A(+ve)	01744-177069	Dr. Rathindra Chandra Deb	01720-629844
2204022	PRETOM SARKER DIPTO	746	ETE	2204022@student.ruet.ac.bd	15-07-2003 (23)	O (+ve)	01765-588425	Rupali Rani Dey	01711-026077
2204023	AMIT KUMAR DAS	747	ETE	2204023@student.ruet.ac.bd	03-02-2004 (22)	O (+ve)	01309-727657	Alok kumar das	01893-437218
2204024	MOHAMMAD NAIM	748	ETE	2204024@student.ruet.ac.bd	31-12-2004 (21)	A(+ve)	01827-272158	MOHAMMAD ABUL BASHAR	01814-134674
2204025	SAMIHA NOSHIN SAMIHA	749	ETE	2204025@student.ruet.ac.bd	25-08-2003 (23)	A(+ve)	01407-641697	Md. Gulam Mustafa	01559-512904
2204026	ABIR HOSSAIN BHUIYAN	750	ETE	2204026@student.ruet.ac.bd	20-01-2004 (22)	O (+ve)	0161-4219580	Abul Kalam Azad	019-15381985
2204027	S. M. ANIK HASAN	751	ETE	2204027@student.ruet.ac.bd	25-12-2003 (22)	A(+ve)	017253-44932	S. M. Anisur Rahman	01740-306577
2204028	MD.JAHID HASAN	752	ETE	2204028@student.ruet.ac.bd	22-04-2005 (21)	O (+ve)	01852-002069	Jahanara Begum	01917-354377
2204029	MST. SAHIDA SULTANA	753	ETE	2204029@student.ruet.ac.bd	15-11-2003 (22)	A(+ve)	01314-234289	Mst.Samnur Khatun	01740-636301
2204030	TANIM SHAHRIAR MITUL	754	ETE	2204030@student.ruet.ac.bd	10-01-2005 (21)	B(+ve)	01718-161488	Mahmuda Yeasmin	01732-044530
2204031	FARIA MOZAHID OTHOY	755	ETE	2204031@student.ruet.ac.bd	25-07-2005 (21)	B(+ve)	01753-583191	Kawaser Zahan Rozi	01713-564248
2204032	MD SHOAB AKTAR	756	ETE	2204032@student.ruet.ac.bd	10-08-2004 (22)	B(+ve)	01795-226000	NS Shakib	01637-717417
2204033	JANNATUL FERDAUS	757	ETE	2204033@student.ruet.ac.bd	11-11-2003 (22)	B(+ve)	01786-314072	MD. ASLAM HOSSAIN	01724-522237
2204034	MD. TAREQ RAHMAN	758	ETE	2204034@student.ruet.ac.bd	03-10-2003 (23)	A(+ve)	01611-172959	Shamsul Haque	0190-2025853
2204035	S.M. TAMJID	759	ETE	2204035@student.ruet.ac.bd	12-02-2005 (21)	AB(+ve)	0191-0021386	Sk. Shafiqul Islam	0173-3555651
2204036	PRATICK CHAKRABORTY DIBBA	760	ETE	2204036@student.ruet.ac.bd	25-12-2003 (22)	B(+ve)	01810-585601	UTPAL CHAKRABORTY	01818-042995
2204037	MD. KHALID HOSSEN	761	ETE	2204037@student.ruet.ac.bd	03-12-2004 (21)	B(+ve)	01568-859871	MD.ABDUS SOBUR	01912-187078
2204038	MD. ANIK HASSAN	762	ETE	2204038@student.ruet.ac.bd	12-12-2003 (22)	O (+ve)	01647-843189	MST.SELINA AKTHER	01727-140040
2204039	MUAMMAR ILHAM	763	ETE	2204039@student.ruet.ac.bd	11-02-2004 (22)	A(+ve)	01846-098619	Mohammad Mahbub Alam	01708-371302
2204040	SANZIDUL ISLAM	764	ETE	2204040@student.ruet.ac.bd	17-07-2004 (22)	B(+ve)	01628-251743	MD. SALIM AKTER	01817-537724
2204041	MD. SOHANUR RAHMAN SOHAN	765	ETE	2204041@student.ruet.ac.bd	10-12-2004 (21)	O (+ve)	01706-028192	Mst. Ruby Khatun	01993-159003
2204042	MOHAIMINUL ISLAM	766	ETE	2204042@student.ruet.ac.bd	05-02-2003 (23)	B(+ve)	01857-768958	MD.MAMUNUR RAHID	01731-624804
2204043	MD. FARHAN LABIB	767	ETE	2204043@student.ruet.ac.bd	01-03-2005 (21)	A(+ve)	01756-966288	MD:Nayeem Ahmed	01756-966288
2204044	ARNOB DAS RICKY	768	ETE	2204044@student.ruet.ac.bd	25-11-2004 (21)	B(+ve)	01764-568562	AMALESH CHANDRA DAS	01612-458412
2204045	TANMOY DEB NATH	769	ETE	2204045@student.ruet.ac.bd	03-08-2003 (23)	B(+ve)	01406-589641	JAGADISH DEB NATH	01674-688217
2204046	ORITREE ZAMAN	770	ETE	2204046@student.ruet.ac.bd	25-03-2005 (21)	AB(+ve)	01304-357067	A. K. M. Maniruzzaman	01718-163763
2204047	TAWFIQ AHMED RAFI	771	ETE	2204047@student.ruet.ac.bd	15-02-2004 (22)	O (+ve)	01766-374078	Md Oli Ullah	01621-807121
2204048	MD. MEHEDY HASAN	772	ETE	2204048@student.ruet.ac.bd	05-07-2004 (22)	B(+ve)	0157-1276579	Mirajul Islam	0162-5688922
2204049	MD MAHABUB HASAN HRIDOY	773	ETE	2204049@student.ruet.ac.bd	27-06-2005 (21)	A(+ve)	01705-381533	MRS FATEMA BEGUM	01759-262833
2204050	FARHAT TASNIM LAMISA	774	ETE	2204050@student.ruet.ac.bd	06-11-2004 (21)	O (+ve)	01937-383421	NURJAHAN BEGUM	01726-978899
2204051	RANESH DAS RIK	775	ETE	2204051@student.ruet.ac.bd	31-12-2005 (20)	O (+ve)	01779-342695	Manik Chandra Das	01712-067854
2204052	TASFIUL MOSTAFA	776	ETE	2204052@student.ruet.ac.bd	24-01-2005 (21)	B(+ve)	01533-574184	Md. Hassan Mostofa	01711-989880
2204053	SHAHRIAR SHAHID SHUVO	777	ETE	2204053@student.ruet.ac.bd	08-12-2004 (21)	A(+ve)	01707-591494	Md. Shahidul Islam	01712-629767
2204054	FATEMA TUZ JOHRA	778	ETE	2204054@student.ruet.ac.bd	12-05-2004 (22)	B(+ve)	01837-088874	Md. Noor-E-Alam	01935-059192
2204055	ADNAN SAKIB ESHA	779	ETE	2204055@student.ruet.ac.bd	17-10-2005 (20)	AB(+ve)	01771-783566	Shahidul Islam	01789-004810
2204056	MD. SYMUL HAQUE	780	ETE	2204056@student.ruet.ac.bd	16-06-2003 (23)	B(+ve)	0175-7181937	MD. Jahirul Haque	0173-7182554
2204057	FARIA MAHJABIN JIME	781	ETE	2204057@student.ruet.ac.bd	24-08-2003 (23)	A (-ve)	01609-303288	Nasrin Akter	01762-931453
2204058	MD. MOSHFIKUR RAHMAN TOSHUN	782	ETE	2204058@student.ruet.ac.bd	15-10-2003 (22)	O (+ve)	0167-5360022	TASLIMA BEGUM	01751-092228
2204059	IFTAKHAR MAHMUD TAMIM	783	ETE	2204059@student.ruet.ac.bd	01-11-2005 (20)	AB(+ve)	016281-10902	Romana Jahana	01684-578169
2204060	IMRUL ISLAM EMON	784	ETE	2204060@student.ruet.ac.bd	25-01-2004 (22)	A(+ve)	01756-243606	Md Shamim Ahmed	01737-655617`;

const rows = rawData.split('\n').slice(1);
const emails = rows.map(row => row.split('\t')[4].trim()).filter(e => e);

const updatePasswords = async () => {
  console.log(`Starting password update for ${emails.length} users to "stu1234"...`);
  
  // Need to fetch user IDs first by listing users, then update
  // Supabase admin api allows fetching users or updating directly if we know ID.
  // Since we know emails, let's fetch users page by page
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  
  if (listError) {
    console.error("Error listing users", listError);
    return;
  }
  
  for (const email of emails) {
    const user = users.find(u => u.email === email);
    if (user) {
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        user.id,
        { password: 'stu1234' }
      );
      if (updateError) {
         console.error(`Failed to update password for ${email}:`, updateError.message);
      } else {
         console.log(`Updated password for ${email}`);
      }
    } else {
      console.log(`User not found: ${email}`);
    }
  }
  
  console.log('Password update complete!');
};

updatePasswords();
