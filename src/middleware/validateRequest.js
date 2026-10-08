// Generic validation middleware using Zod
export const validateRequest = (schema) => {
  return (req, res, next) => {
    try {
      const validatedData = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // In Express 5, req.query and req.params have getters and cannot be directly reassigned.
      // We overwrite req.body, and for query/params we merge the validated data back if needed,
      // or we just rely on validation.
      req.body = validatedData.body;
      if (validatedData.query) Object.assign(req.query, validatedData.query);
      if (validatedData.params) Object.assign(req.params, validatedData.params);

      next();
    } catch (err) {
      if (err.name === 'ZodError') {
        const errors = err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({ error: 'Validation Error', details: errors });
      }
      next(err);
    }
  };
};
