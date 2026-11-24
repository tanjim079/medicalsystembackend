import supabase from '../config/supabase.js';
import { logger } from '../config/logger.js';

export const LOW_STOCK_THRESHOLD = 10;

const toDateKey = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
};

const lastNDays = (n) => {
  const days = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
};

// Resolves a Supabase query and returns { data, count } or null on failure,
// recording the failing source so the dashboard can still render partial data.
const settle = async (label, queryPromise, warnings) => {
  try {
    const { data, count, error } = await queryPromise;
    if (error) throw error;
    return { data: data || [], count: typeof count === 'number' ? count : (data || []).length };
  } catch (err) {
    warnings.push(label);
    logger.warn(`[Admin] Failed to load ${label}: ${err.message}`);
    return null;
  }
};

const countOf = (table) =>
  supabase.from(table).select('id', { count: 'exact', head: true });

// @desc    Aggregated system statistics for the admin dashboard
// @route   GET /api/admin/stats
// @access  Admin
export const getStats = async (req, res) => {
  const warnings = [];
  const days14 = lastNDays(14);
  const days30 = lastNDays(30);
  const today = days14[days14.length - 1];

  const [
    profilesRes,
    appointmentsRes,
    prescriptionsRes,
    certificatesRes,
    labRequestsRes,
    labReportsRes,
    billsRes,
    medicinesRes,
    testsRes
  ] = await Promise.all([
    settle('users', supabase.from('profiles').select('id, role, created_at'), warnings),
    settle('appointments', supabase.from('appointments').select('id, date, status, "doctorId", "doctorName"'), warnings),
    settle('prescriptions', countOf('prescriptions'), warnings),
    settle('certificates', countOf('certificates'), warnings),
    settle('lab requests', supabase.from('lab_requests').select('id, status'), warnings),
    settle('lab reports', countOf('lab_reports'), warnings),
    settle('bills', supabase.from('bills').select('id, "totalAmount", status, date'), warnings),
    settle('medicines', supabase.from('medicines').select('id, name, stock'), warnings),
    settle('medical tests', countOf('medical_tests'), warnings)
  ]);

  // Users
  const profiles = profilesRes?.data || [];
  const usersByRole = {};
  profiles.forEach((p) => {
    const role = p.role || 'unknown';
    usersByRole[role] = (usersByRole[role] || 0) + 1;
  });
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const newUsers30d = profiles.filter((p) => p.created_at && new Date(p.created_at).getTime() >= thirtyDaysAgo).length;

  // Appointments
  const appointments = appointmentsRes?.data || [];
  const appointmentsByStatus = {};
  const appointmentsPerDay = Object.fromEntries(days14.map((d) => [d, 0]));
  const doctorLoad = {};
  appointments.forEach((a) => {
    const status = (a.status || 'unknown').toLowerCase();
    appointmentsByStatus[status] = (appointmentsByStatus[status] || 0) + 1;
    const key = typeof a.date === 'string' ? a.date.slice(0, 10) : toDateKey(a.date);
    if (key && key in appointmentsPerDay) appointmentsPerDay[key] += 1;
    if (a.doctorId) {
      if (!doctorLoad[a.doctorId]) doctorLoad[a.doctorId] = { doctorId: a.doctorId, doctorName: a.doctorName || 'Unknown', total: 0, pending: 0 };
      doctorLoad[a.doctorId].total += 1;
      if (status === 'pending') doctorLoad[a.doctorId].pending += 1;
    }
  });
  const appointmentsToday = appointments.filter((a) => typeof a.date === 'string' && a.date.slice(0, 10) === today).length;

  // Laboratory
  const labRequests = labRequestsRes?.data || [];
  const labByStatus = {};
  labRequests.forEach((r) => {
    const s = r.status || 'Unknown';
    labByStatus[s] = (labByStatus[s] || 0) + 1;
  });

  // Billing
  const bills = billsRes?.data || [];
  let revenueCollected = 0;
  let revenueDue = 0;
  const revenuePerDay = Object.fromEntries(days30.map((d) => [d, 0]));
  bills.forEach((b) => {
    const amount = Number(b.totalAmount) || 0;
    if (b.status === 'Paid') {
      revenueCollected += amount;
      const key = toDateKey(b.date);
      if (key && key in revenuePerDay) revenuePerDay[key] += amount;
    } else {
      revenueDue += amount;
    }
  });

  // Inventory
  const medicines = medicinesRes?.data || [];
  const lowStock = medicines
    .filter((m) => Number(m.stock) < LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.stock - b.stock);
  const outOfStock = medicines.filter((m) => Number(m.stock) <= 0).length;

  res.status(200).json({
    generatedAt: new Date().toISOString(),
    users: {
      total: profilesRes ? profiles.length : null,
      byRole: usersByRole,
      newLast30Days: newUsers30d
    },
    appointments: {
      total: appointmentsRes ? appointments.length : null,
      today: appointmentsToday,
      byStatus: appointmentsByStatus,
      trend: days14.map((date) => ({ date, count: appointmentsPerDay[date] })),
      topDoctors: Object.values(doctorLoad).sort((a, b) => b.total - a.total).slice(0, 5)
    },
    clinical: {
      prescriptions: prescriptionsRes?.count ?? null,
      certificates: certificatesRes?.count ?? null
    },
    laboratory: {
      requests: labRequestsRes ? labRequests.length : null,
      pending: (labByStatus.Pending || 0) + (labByStatus['Awaiting Payment'] || 0),
      byStatus: labByStatus,
      reports: labReportsRes?.count ?? null,
      catalogSize: testsRes?.count ?? null
    },
    billing: {
      totalBills: billsRes ? bills.length : null,
      revenueCollected: Number(revenueCollected.toFixed(2)),
      revenueDue: Number(revenueDue.toFixed(2)),
      trend: days30.map((date) => ({ date, amount: Number(revenuePerDay[date].toFixed(2)) }))
    },
    inventory: {
      totalMedicines: medicinesRes ? medicines.length : null,
      totalUnits: medicines.reduce((s, m) => s + (Number(m.stock) || 0), 0),
      lowStockThreshold: LOW_STOCK_THRESHOLD,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock,
      lowStock: lowStock.slice(0, 8)
    },
    warnings
  });
};

// @desc    Recent cross-module activity feed
// @route   GET /api/admin/activity?limit=20
// @access  Admin
export const getActivity = async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const warnings = [];

  const [apptRes, rxRes, billRes, userRes] = await Promise.all([
    settle('appointments', supabase.from('appointments')
      .select('id, "patientName", "doctorName", status, date, "createdAt"')
      .order('createdAt', { ascending: false }).limit(limit), warnings),
    settle('prescriptions', supabase.from('prescriptions')
      .select('id, "patientName", "doctorName", diagnosis, "createdAt"')
      .order('createdAt', { ascending: false }).limit(limit), warnings),
    settle('bills', supabase.from('bills')
      .select('id, "patientName", "totalAmount", status, date')
      .order('date', { ascending: false }).limit(limit), warnings),
    settle('users', supabase.from('profiles')
      .select('id, name, role, created_at')
      .order('created_at', { ascending: false }).limit(limit), warnings)
  ]);

  const events = [
    ...(apptRes?.data || []).map((a) => ({
      id: `appt-${a.id}`,
      type: 'appointment',
      title: `Appointment ${a.status || 'booked'}`,
      description: `${a.patientName || 'Patient'} with ${a.doctorName || 'doctor'} on ${a.date || '—'}`,
      timestamp: a.createdAt
    })),
    ...(rxRes?.data || []).map((p) => ({
      id: `rx-${p.id}`,
      type: 'prescription',
      title: 'Prescription issued',
      description: `${p.doctorName || 'Doctor'} → ${p.patientName || 'patient'}${p.diagnosis ? ` (${p.diagnosis})` : ''}`,
      timestamp: p.createdAt
    })),
    ...(billRes?.data || []).map((b) => ({
      id: `bill-${b.id}`,
      type: 'bill',
      title: `Bill ${b.status === 'Paid' ? 'paid' : 'created'}`,
      description: `${b.patientName || 'Patient'} — ৳${Number(b.totalAmount || 0).toFixed(2)}`,
      timestamp: b.date
    })),
    ...(userRes?.data || []).map((u) => ({
      id: `user-${u.id}`,
      type: 'user',
      title: 'Account registered',
      description: `${u.name || 'User'} (${u.role || 'user'})`,
      timestamp: u.created_at
    }))
  ]
    .filter((e) => e.timestamp)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);

  res.status(200).json({ events, warnings });
};
