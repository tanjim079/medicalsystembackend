import supabase from '../config/supabase.js';

// @desc    Get all users or filter by role
// @route   GET /api/users
// @access  Public (Should be protected in production)
export const getUsers = async (req, res) => {
  try {
    let query = supabase.from('profiles').select('*, patients(*)');
    
    if (req.query.role) {
      query = query.eq('role', req.query.role);
    }
    
    query = query.order('name', { ascending: true });

    const { data, error } = await query;

    if (error) throw error;
    
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Create user
// @route   POST /api/users
export const createUser = async (req, res) => {
  try {
    const { email, password, role, name, patientData } = req.body;
    
    if (!email || !password || !role || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role }
    });
    
    if (error) throw error;
    
    // Check if profile was created by trigger, if not create it
    const { data: existingProfile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    if (!existingProfile) {
      await supabase.from('profiles').insert({
        id: data.user.id,
        email: email,
        name: name,
        role: role
      });
    }

    if (patientData && ['student', 'teacher', 'officer', 'patient'].includes(role)) {
      await supabase.from('patients').upsert({
        id: data.user.id,
        roll_number: patientData.universityId || null,
        phone: patientData.phone || null,
        blood_group: patientData.bloodGroup || null,
        guardian_name: patientData.guardianName || null,
        guardian_phone: patientData.guardianPhone || null,
        department: patientData.department || null,
        age: patientData.age || null
      });
    }
    
    res.status(201).json({ id: data.user.id, email, name, role });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, role, name, patientData } = req.body;
    
    const updateData = {};
    if (email) updateData.email = email;
    if (password) updateData.password = password;
    if (name || role) {
      updateData.user_metadata = {};
      if (name) updateData.user_metadata.name = name;
      if (role) updateData.user_metadata.role = role;
    }

    // Only update auth if we have something to update
    if (Object.keys(updateData).length > 0) {
      const { error: authError } = await supabase.auth.admin.updateUserById(id, updateData);
      if (authError) throw authError;
    }
    
    // Update profile
    const profileUpdate = {};
    if (name) profileUpdate.name = name;
    if (role) profileUpdate.role = role;
    if (email) profileUpdate.email = email;
    
    if (Object.keys(profileUpdate).length > 0) {
      const { error: profileError } = await supabase.from('profiles').update(profileUpdate).eq('id', id);
      if (profileError) throw profileError;
    }

    if (patientData) {
      // Upsert into patients table
      const { error: patientError } = await supabase.from('patients').upsert({
        id: id,
        roll_number: patientData.universityId || null,
        phone: patientData.phone || null,
        blood_group: patientData.bloodGroup || null,
        guardian_name: patientData.guardianName || null,
        guardian_phone: patientData.guardianPhone || null,
        department: patientData.department || null,
        age: patientData.age || null
      });
      if (patientError) throw patientError;
    }
    
    res.status(200).json({ id, ...profileUpdate });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    // This will cascade delete from profiles if fk constraint is set with ON DELETE CASCADE
    // But let's delete manually from profiles first to be safe
    await supabase.from('profiles').delete().eq('id', id);
    
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw error;
    
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
