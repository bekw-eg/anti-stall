import { E } from './errors.js';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

export function cleanText(value) {
  return String(value).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

export function reqString(value, field, { min = 1, max = 100 } = {}) {
  if (typeof value !== 'string') throw E.badRequest('INVALID_FIELD', `Поле ${field} должно быть строкой`, { field });
  const v = cleanText(value);
  if (v.length < min || v.length > max) {
    throw E.badRequest('INVALID_FIELD', `Поле ${field}: длина должна быть от ${min} до ${max}`, { field });
  }
  return v;
}

export function optString(value, field, opts) {
  if (value === undefined || value === null) return null;
  return reqString(value, field, { min: 0, ...opts });
}

export function reqInt(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw E.badRequest('INVALID_FIELD', `Поле ${field} должно быть целым числом от ${min} до ${max}`, { field });
  }
  return value;
}

export function reqBool(value, field) {
  if (typeof value !== 'boolean') throw E.badRequest('INVALID_FIELD', `Поле ${field} должно быть boolean`, { field });
  return value;
}

export function reqObject(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw E.badRequest('INVALID_BODY', 'Тело запроса должно быть JSON-объектом');
  return value;
}
