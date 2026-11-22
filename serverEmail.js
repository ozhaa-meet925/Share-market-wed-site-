import nodemailer from 'nodemailer';

const env = (key) => String(process.env[key] || '').trim();

let transport = null;
let transportKey = '';
const sentAt = [];

export const emailConfig = () => {
  const host = env('SMTP_HOST');
  const user = env('SMTP_USER');
  const pass = env('SMTP_PASS');
  const from = env('SMTP_FROM') || user;
  const port = Number(env('SMTP_PORT')) || 587;
  const missing = [];
  if (!host) missing.push('SMTP_HOST');
  if (!from) missing.push('SMTP_FROM or SMTP_USER');
  if (user && !pass) missing.push('SMTP_PASS');
  return {
    configured: missing.length === 0,
    host: host || null,
    port,
    secure: env('SMTP_SECURE') === '1' || port === 465,
    from: from || null,
    authUser: user || null,
    missing,
  };
};

const getTransport = () => {
  const config = emailConfig();
  if (!config.configured) return null;
  const key = `${config.host}:${config.port}:${config.secure}:${config.from}:${config.authUser || ''}`;
  if (transport && transportKey === key) return transport;
  transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.authUser ? { user: config.authUser, pass: env('SMTP_PASS') } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  transportKey = key;
  return transport;
};

export const sendEmail = async ({ to, subject, text }) => {
  const config = emailConfig();
  if (!config.configured || !to) return { sent: false, reason: config.configured ? 'missing_recipient' : 'not_configured' };
  const now = Date.now();
  while (sentAt.length && now - sentAt[0] > 60_000) sentAt.shift();
  if (sentAt.length >= 30) return { sent: false, reason: 'rate_limited' };
  sentAt.push(now);
  try {
    const info = await getTransport().sendMail({
      from: config.from,
      to,
      subject: String(subject).slice(0, 180),
      text: String(text).slice(0, 4000),
    });
    return { sent: true, messageId: info?.messageId || null };
  } catch (error) {
    console.warn('Email notification failed:', error.message);
    return { sent: false, reason: 'smtp_error', error: error.message };
  }
};

export const emailStatus = () => {
  const config = emailConfig();
  return {
    supported: true,
    configured: config.configured,
    enabled: config.configured,
    host: config.host,
    port: config.port,
    from: config.from,
    missing: config.missing,
    reason: config.configured
      ? 'SMTP delivery is configured. Signed-in users can opt in to trade, order, risk and market-news emails.'
      : `Email delivery needs ${config.missing.join(', ')} on the server.`,
  };
};
