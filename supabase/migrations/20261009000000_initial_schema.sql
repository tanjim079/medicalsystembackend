-- Table: appointments
CREATE TABLE IF NOT EXISTS public.appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "patientId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "doctorName" TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    symptoms TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: prescriptions
CREATE TABLE IF NOT EXISTS public.prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "patientId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "doctorName" TEXT NOT NULL,
    date TEXT NOT NULL,
    diagnosis TEXT NOT NULL,
    medicines JSONB NOT NULL,
    advice TEXT,
    status TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: lab_requests
CREATE TABLE IF NOT EXISTS public.lab_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "patientId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    category TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: lab_reports
CREATE TABLE IF NOT EXISTS public.lab_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "requestId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    category TEXT NOT NULL,
    results JSONB NOT NULL,
    "validatedBy" TEXT,
    "validatedByName" TEXT,
    "validatedAt" TEXT,
    status TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: certificates
CREATE TABLE IF NOT EXISTS public.certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "patientId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "doctorName" TEXT NOT NULL,
    date TEXT NOT NULL,
    diagnosis TEXT NOT NULL,
    "restStartDate" TEXT NOT NULL,
    "restEndDate" TEXT NOT NULL,
    "recommendedRestDays" INTEGER NOT NULL,
    remarks TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: bills
CREATE TABLE IF NOT EXISTS public.bills (
    id TEXT PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    tests JSONB NOT NULL,
    "subTotal" NUMERIC NOT NULL,
    discount NUMERIC NOT NULL,
    tax NUMERIC NOT NULL,
    "totalAmount" NUMERIC NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    status TEXT NOT NULL,
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Role Type update
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'teacher';

-- Table: teachers
CREATE TABLE IF NOT EXISTS public.teachers (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    name TEXT NOT NULL,
    designation TEXT NOT NULL,
    department TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: Ensure Row Level Security (RLS) is disabled or appropriate policies are created.
