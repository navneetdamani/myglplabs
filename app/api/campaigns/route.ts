import { ensureSchema, getDb } from '@/lib/db';

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const values = {
    title: String(body.title || '').trim(),
    campaignType: String(body.campaignType || '').trim(),
    category: String(body.category || '').trim(),
    neighborhood: String(body.neighborhood || '').trim(),
    zipCode: String(body.zipCode || '').trim(),
    desiredTimeframe: String(body.desiredTimeframe || '').trim(),
    targetGroupSize: Math.max(5, Math.min(100, Number(body.targetGroupSize || 10))),
    description: String(body.description || '').trim(),
    contactName: String(body.contactName || '').trim(),
    contactEmail: String(body.contactEmail || '').trim().toLowerCase(),
  };
  if (Object.entries(values).some(([key, value]) => key !== 'targetGroupSize' && !value) || !/^\d{5}$/.test(values.zipCode) || !/^\S+@\S+\.\S+$/.test(values.contactEmail)) {
    return Response.json({ error: 'Please complete all fields with a valid email and 5-digit ZIP code.' }, { status: 400 });
  }
  const db = getDb();
  await ensureSchema(db);
  await db.prepare(`INSERT INTO campaign_requests (title,campaign_type,category,neighborhood,zip_code,desired_timeframe,target_group_size,description,contact_name,contact_email) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(values.title, values.campaignType, values.category, values.neighborhood, values.zipCode, values.desiredTimeframe, values.targetGroupSize, values.description, values.contactName, values.contactEmail).run();
  return Response.json({ ok: true });
}
