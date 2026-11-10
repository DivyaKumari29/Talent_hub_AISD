// Small input validators (NFR: input validation on every write).
const { bad } = require('./errors');

const str = (v, name, { min = 1, max = 100 } = {}) => {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max)
    throw bad(`${name} must be text of ${min}-${max} characters`);
  return v.trim();
};
const num = (v, name, { min = -Infinity, max = Infinity } = {}) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw bad(`${name} must be a number between ${min} and ${max}`);
  return v;
};
const int = (v, name, { min = 0, max = 1e9 } = {}) => {
  if (!Number.isInteger(v) || v < min || v > max)
    throw bad(`${name} must be a whole number between ${min} and ${max}`);
  return v;
};
const date = (v, name) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))
    throw bad(`${name} must be a date like 2026-12-31`);
  return v;
};
const datetime = (v, name) => {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw bad(`${name} must be a date and time (ISO 8601)`);
  return new Date(v).toISOString();
};
const email = (v) => {
  const e = str(v, 'email', { max: 100 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('email is not valid');
  return e;
};
const id = (v, name = 'id') => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw bad(`${name} is not valid`);
  return n;
};
module.exports = { str, num, int, date, datetime, email, id };
