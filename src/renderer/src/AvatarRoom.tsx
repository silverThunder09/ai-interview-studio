import { lazy, Suspense, type ComponentProps } from 'react';
import type { AvatarPanel } from './avatar/AvatarPanel';

const Panel = lazy(() => import('./avatar/AvatarPanel').then(module => ({ default: module.AvatarPanel })));
export function AvatarRoom(props: ComponentProps<typeof AvatarPanel>) {
  return <Suspense fallback={<p role="status">3D 면접 화면을 불러오는 중입니다.</p>}><Panel {...props} /></Suspense>;
}
