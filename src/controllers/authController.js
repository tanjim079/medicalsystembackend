import supabase from '../config/supabase.js';

// @desc    Register a new user (Patient or Doctor)
// @route   POST /api/auth/signup
export const signup = async (req, res) => {
  const { email, password, role, name } = req.body;

  if (!email || !password || !role || !name) {
    return res.status(400).json({ error: 'Please provide email, password, role, and name' });
  }

  try {
    // 1. Sign up the user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name,
          role: role // 'patient' or 'doctor'
        }
      }
    });

    if (authError) throw authError;

    // Optional: If you have a public 'users' table, you can insert the profile here.
    // We are storing the role in auth metadata for now.

    res.status(201).json({
      message: 'User registered successfully!',
      user: authData.user,
      session: authData.session
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Please provide email and password' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    res.status(200).json({
      message: 'Login successful',
      user: data.user,
      session: data.session
    });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
};
