'use client';
import {useT} from '@/i18n/react';
export default function Loading(){const t=useT();return <p role="status" className="demo-main">{t('Loading…')}</p>;}
