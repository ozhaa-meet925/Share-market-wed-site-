const USERS_KEY = 'sharemarket:users';
const SESSION_KEY = 'sharemarket:session';

const readUsers = () => {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
  } catch {
    return [];
  }
};

export const getCurrentUser = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
};

export const registerUser = ({ name, email, password, phone, dob, bank, accountHolder, dematBroker, dematId }) => {
  const users = readUsers();
  if (users.some((user) => user.email === email.toLowerCase())) throw new Error('An account with this email already exists.');
  const user = {
    id: `USR-${Date.now()}`,
    name,
    email: email.toLowerCase(),
    password,
    phone,
    dob,
    bank,
    accountHolder,
    dematBroker: dematBroker || 'ShareMarket PRO',
    dematId: dematId || `SM-${Math.floor(10000000 + Math.random() * 90000000)}`,
    kycStatus: 'verified',
    linkedDemat: true,
  };
  localStorage.setItem(USERS_KEY, JSON.stringify([...users, user]));
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  return user;
};

export const loginWithDemat = ({ broker, dematId, pin }) => {
  if (!dematId || dematId.length < 4) throw new Error('Enter a valid Demat Client ID / UCC.');
  if (!pin || pin.length < 4) throw new Error('Enter your 4 or 6-digit Demat Trading PIN.');

  const users = readUsers();
  let user = users.find((u) => u.dematId?.toUpperCase() === dematId.toUpperCase() || u.email?.includes(dematId.toLowerCase()));
  if (!user) {
    // Auto-create or connect demo Demat account
    const brokerName = broker || 'ShareMarket';
    user = {
      id: `USR-${Date.now()}`,
      name: 'ShareMarket Trader',
      email: `${dematId.toLowerCase()}@sharemarket.in`,
      phone: '9876543210',
      dematBroker: 'ShareMarket PRO',
      dematId: dematId.toUpperCase(),
      kycStatus: 'verified',
      linkedDemat: true,
      bank: 'HDFC Bank',
    };
    localStorage.setItem(USERS_KEY, JSON.stringify([...users, user]));
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  return user;
};

export const loginUser = ({ email, password }) => {
  const user = readUsers().find((item) => item.email === email.toLowerCase() && item.password === password);
  if (!user) throw new Error('Email or password is incorrect.');
  const session = { id: user.id, name: user.name, email: user.email };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
};

export const loginUserByPhone = ({ phone }) => {
  const user = readUsers().find((item) => item.phone === phone);
  if (!user) throw new Error('No account was found for this phone number.');
  const session = { id: user.id, name: user.name, email: user.email, phone: user.phone, bank: user.bank, kycStatus: user.kycStatus };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
};

export const logoutUser = () => localStorage.removeItem(SESSION_KEY);
