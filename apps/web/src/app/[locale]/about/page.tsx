import About from '@/ui/About';
import {pageMetadata} from '@/i18n/metadata';
export const generateMetadata = pageMetadata('about');
export default function Page(){ return <About/>; }
