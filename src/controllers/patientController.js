import supabase from '../config/supabase.js';

// @desc    Get all patients
// @route   GET /api/patients
export const getPatients = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, email, created_at, role, patients(roll_number, registration_number, phone, guardian_phone, blood_group), teachers(employee_id, phone, department, designation)')
      .in('role', ['student', 'teacher', 'officer', 'patient']);

    if (error) throw error;

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get comprehensive patient profile by ID or roll_number
// @route   GET /api/patients/:id
export const getPatientById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if ID is UUID, otherwise treat as roll_number
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
    let patientId = id.trim();

    console.log('--- ROUTE HIT ---');
    console.log('Raw ID:', id, 'Length:', id.length);
    console.log('Is UUID:', isUUID);

          if (!isUUID) {
        console.log('Searching by roll_number or employee_id:', patientId);
        let { data: patientRecord, error: pError } = await supabase
          .from('patients')
          .select('id')
          .eq('roll_number', patientId).limit(1).maybeSingle();
          
        if (!patientRecord) {
           const { data: teacherRecord } = await supabase
             .from('teachers')
             .select('id')
             .eq('employee_id', patientId).limit(1).maybeSingle();
           if (teacherRecord) {
             patientRecord = teacherRecord;
             pError = null;
           }
        }
        
        if (pError || !patientRecord) {
          return res.status(404).json({ error: 'Patient not found' });
        }
        patientId = patientRecord.id;
      }

    console.log('Found patient UUID:', patientId);

    // 1. Fetch Profile Data
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', patientId)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      console.warn('Patient profile not found in profiles table, checking fallbacks');
    }

    // 2. Fetch Patient Specific Data
    const { data: patientData, error: patientError } = await supabase
      .from('patients')
      .select('*')
      .eq('id', patientId)
      .maybeSingle();

    let specificData = patientData;
    
    // Check teachers table if not found in patients table
    if (!specificData) {
      const { data: teacherData } = await supabase
        .from('teachers')
        .select('*')
        .eq('id', patientId)
        .maybeSingle();
      if (teacherData) {
        specificData = teacherData;
      }
    }

    if (!profile && !specificData) {
      return res.status(404).json({ error: 'Patient profile not found in database' });
    }

    let patientName = profile?.name || specificData?.name || null;
    let patientEmail = profile?.email || null;

    if (!patientName) {
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(patientId);
        if (authUser?.user) {
          patientName = authUser.user.user_metadata?.name || null;
          patientEmail = patientEmail || authUser.user.email;
        }
      } catch (authErr) {
        console.warn('Auth user lookup fallback error:', authErr.message);
      }
    }
    const secretKeyExists = !!process.env.SUPABASE_SECRET_KEY;
    console.log('Query ID:', patientId);
    console.log('Secret Key exists?', secretKeyExists);
    console.log('Patient Data Result:', patientData);
    console.log('-------------------------');

    // 3. Fetch Treatment History
    // 3. Fetch Treatment History (from prescriptions table)
    const { data: treatments, error: treatmentsError } = await supabase
      .from('prescriptions')
      .select('id, date, diagnosis, doctorName')
      .eq('patientId', patientId)
      .order('date', { ascending: false });

    // 4. Fetch Lab Reports
    const { data: rawLabReports, error: labError } = await supabase
      .from('lab_reports')
      .select('*')
      .order('date', { ascending: false });

    let labReports = [];
    if (!labError && rawLabReports) {
      const unpacked = rawLabReports.map(record => {
        let json = {};
        if (record.result) {
          try { json = JSON.parse(record.result); } catch (e) {}
        }
        const isFinal = record.validated || json.status === 'Completed' || json.status === 'Validated';
        return {
          ...json,
          id: record.id || json.id || '',
          patientId: record.patient_id || json.patientId || '',
          patientName: json.patientName || patientName || 'Unknown Patient',
          testName: record.test_name || json.testName || 'Unknown Test',
          status: isFinal ? 'Completed' : (json.status || 'Pending'),
          date: record.date || json.date || new Date().toISOString().split('T')[0],
          requestedAt: json.requestedAt || new Date().toISOString(),
          completedAt: json.completedAt || json.validatedAt || record.date || new Date().toISOString(),
          validatedAt: json.validatedAt || json.completedAt || record.date || new Date().toISOString()
        };
      });

      const pIdLower = String(patientId).toLowerCase();
      const rollLower = specificData?.roll_number ? String(specificData.roll_number).toLowerCase() : '';
      const empLower = specificData?.employee_id ? String(specificData.employee_id).toLowerCase() : '';

      labReports = unpacked.filter(r => {
        const rPat = String(r.patientId || '').toLowerCase();
        return rPat === pIdLower || (rollLower && rPat === rollLower) || (empLower && rPat === empLower);
      });
    }

    // Calculate age from date_of_birth
    let calculatedAge = "N/A";
    if (specificData && specificData.date_of_birth) {
      const dob = new Date(specificData.date_of_birth);
      const diffMs = Date.now() - dob.getTime();
      const ageDt = new Date(diffMs); 
      calculatedAge = Math.abs(ageDt.getUTCFullYear() - 1970);
    } else if (specificData && specificData.age) {
      calculatedAge = specificData.age; // fallback for older records
    }

    // Combine everything into one big JSON object matching the UI
    const comprehensiveData = {
      id: profile ? profile.id : patientId,
      email: patientEmail,
      name: (patientName || profile?.name || 'Unknown'),
      ...specificData, // adds phone, blood_group, guardian info, etc.
      name: (patientName || specificData?.name || profile?.name || 'Unknown'),
      age: calculatedAge,
      treatmentHistory: treatments || [],
      labReports: labReports || [],
      visitSummary: {
        totalVisits: treatments?.length || 0,
        lastVisit: treatments?.[0]?.date || null
      }
    };

    res.status(200).json(comprehensiveData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Register a new patient with full details
// @route   POST /api/patients
export const createPatient = async (req, res) => {
  try {
    const { 
      email, password, name, 
      roll_number, registration_number, 
      phone, date_of_birth, blood_group, guardian_name, guardian_phone, department 
    } = req.body;

    // 1. Create the user in Supabase Auth (This automatically triggers profiles creation)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: 'patient' }
    });

    if (authError) throw authError;

    const newUserId = authData.user.id;

    // 2. Insert the extra medical data into the patients table
    const { data: patientData, error: patientError } = await supabase
      .from('patients')
      .insert([
        {
          id: newUserId,
          roll_number,
          registration_number,
          phone,
          date_of_birth,
          blood_group,
          guardian_name,
          guardian_phone,
          department
        }
      ])
      .select();

    if (patientError) {
      throw patientError;
    }

    res.status(201).json({ 
      message: 'Patient registered successfully', 
      user: authData.user,
      patientDetails: patientData[0]
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Update a patient's medical details
// @route   PUT /api/patients/:id
export const updatePatient = async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = req.body; // e.g. { date_of_birth: "...", registration_number: "..." }

    // First check if ID is UUID or roll_number
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let patientId = id;

          if (!isUUID) {
        console.log('Searching by roll_number or employee_id:', patientId);
        let { data: patientRecord, error: pError } = await supabase
          .from('patients')
          .select('id')
          .eq('roll_number', patientId).limit(1).maybeSingle();
          
        if (!patientRecord) {
           const { data: teacherRecord } = await supabase
             .from('teachers')
             .select('id')
             .eq('employee_id', patientId).limit(1).maybeSingle();
           if (teacherRecord) {
             patientRecord = teacherRecord;
             pError = null;
           }
        }
        
        if (pError || !patientRecord) {
          return res.status(404).json({ error: 'Patient not found' });
        }
        patientId = patientRecord.id;
      }

    // Now update the patients table
    const { data, error } = await supabase
      .from('patients')
      .update(updateFields)
      .eq('id', patientId)
      .select();

    if (error) throw error;

    res.status(200).json({
      message: 'Patient updated successfully',
      patientDetails: data[0]
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
