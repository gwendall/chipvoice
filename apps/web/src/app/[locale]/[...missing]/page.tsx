import {notFound} from 'next/navigation';
import {pageMetadata} from '@/i18n/metadata';
export const generateMetadata=pageMetadata('missing');
export default function Page(){notFound();}
