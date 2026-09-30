import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { BottomNav, LoadingList, Page } from '@/components/app';
import Home from '@/pages/Home';

// Bosh sahifa darhol yuklanadi, qolganlari birinchi ochilganda (Mini App tezroq ochiladi)
const DraftReview = lazy(() => import('@/pages/DraftReview'));
const NewTest = lazy(() => import('@/pages/NewTest'));
const Profile = lazy(() => import('@/pages/Profile'));
const RaceDetail = lazy(() => import('@/pages/RaceDetail'));
const TemplateView = lazy(() => import('@/pages/TemplateView'));

function PageFallback() {
  return (
    <Page>
      <LoadingList rows={3} />
    </Page>
  );
}

export default function App() {
  return (
    <>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/new" element={<NewTest />} />
          <Route path="/draft/:id" element={<DraftReview />} />
          <Route path="/template/:id" element={<TemplateView />} />
          <Route path="/race/:id" element={<RaceDetail />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
      <BottomNav />
      <Toaster position="top-center" toastOptions={{ duration: 2200 }} />
    </>
  );
}
