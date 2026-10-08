import supabase from '../config/supabase.js';

// @desc    Register a new user (Patient or Doctor)
// @route   POST /api/auth/signup
export const signup = async (req, res, next) => {
  const { email, password, role, name } = req.body;

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

    res.status(201).json({
      message: 'User registered successfully!',
      user: authData.user,
      session: authData.session
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
export const login = async (req, res, next) => {
  const { email, password } = req.body;

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
    next(error);
  }
};
