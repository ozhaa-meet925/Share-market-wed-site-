process.env.VERCEL_FUNCTIONS = '1';

const { default: app } = await import('../server.js');

export default app;
