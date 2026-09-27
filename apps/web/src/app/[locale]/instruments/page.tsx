import Instruments from '@/ui/Instruments';
import {pageMetadata} from '@/i18n/metadata';
export const generateMetadata = pageMetadata('instruments');
export default async function Page({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  return <Instruments locale={locale}/>;
}
