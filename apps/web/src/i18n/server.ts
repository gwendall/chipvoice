import 'server-only';
import type {Locale} from './core';
export const getMessages = async (locale: Locale) => (await (locale === 'ja' ? import('./messages/ja.json') : import('./messages/en.json'))).default;
