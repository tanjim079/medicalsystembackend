import supabase from '../config/supabase.js';

// Verify JWT token and attach user to req
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    
    // Validate token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
};

// Check if user has one of the required roles
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: User not authenticated' });
    }

    const userRole = req.user.user_metadata?.role;
    
    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: `Forbidden: Requires one of roles [${allowedRoles.join(', ')}]` 
      });
    }

    next();
  };
};
