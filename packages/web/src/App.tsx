import { Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { BottomNav } from '@/components/app';
import DraftReview from '@/pages/DraftReview';
import Home from '@/pages/Home';
import NewTest from '@/pages/NewTest';
import Profile from '@/pages/Profile';
import RaceDetail from '@/pages/RaceDetail';
import TemplateView from '@/pages/TemplateView';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewTest />} />
        <Route path="/draft/:id" element={<DraftReview />} />
        <Route path="/template/:id" element={<TemplateView />} />
        <Route path="/race/:id" element={<RaceDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <BottomNav />
      <Toaster position="top-center" toastOptions={{ duration: 2200 }} />
    </>
  );
}
