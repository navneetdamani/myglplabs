import { ensureSchema, getDb } from '@/lib/db';

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const mobile = String(body.mobile || '').trim();
  const zipCode = String(body.zipCode || '').trim();
  const neighborhood = String(body.neighborhood || '').trim();
  const residentType = String(body.residentType || '').trim();
  const preferredChannel = String(body.preferredChannel || '').trim();
  const interests = Array.isArray(body.interests) ? body.interests.map(String).slice(0, 12) : [];

  if (!firstName || !lastName || !/^\S+@\S+\.\S+$/.test(email) || !/^\d{5}$/.test(zipCode) || !neighborhood || !residentType || !preferredChannel || !interests.length) {
    return Response.json({ error: 'Please complete every required field and choose at least one interest.' }, { status: 400 });
  }
  if (preferredChannel === 'sms' && !mobile) {
    return Response.json({ error: 'Add a mobile number to receive text notifications.' }, { status: 400 });
  }

  const db = getDb();
  await ensureSchema(db);
  const existing = await db.prepare('SELECT id FROM signups WHERE email = ? AND zip_code = ?').bind(email, zipCode).first<{ id: number }>();
  let signupId = existing?.id;
  if (signupId) {
    await db.prepare(`UPDATE signups SET first_name=?, last_name=?, mobile=?, neighborhood=?, resident_type=?, preferred_channel=?, email_consent=?, sms_consent=? WHERE id=?`)
      .bind(firstName, lastName, mobile, neighborhood, residentType, preferredChannel, 1, preferredChannel === 'sms' ? 1 : 0, signupId).run();
    await db.prepare('DELETE FROM signup_interests WHERE signup_id = ?').bind(signupId).run();
  } else {
    const result = await db.prepare(`INSERT INTO signups (first_name,last_name,email,mobile,zip_code,neighborhood,resident_type,preferred_channel,email_consent,sms_consent) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(firstName, lastName, email, mobile, zipCode, neighborhood, residentType, preferredChannel, 1, preferredChannel === 'sms' ? 1 : 0).run();
    signupId = Number(result.meta.last_row_id);
  }
  await db.batch(interests.map((interest) => db.prepare('INSERT INTO signup_interests (signup_id, interest) VALUES (?, ?)').bind(signupId, interest)));
  return Response.json({ ok: true });
}
