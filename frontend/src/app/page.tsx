'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { RippleButton } from '@/components/ui/ripple-button';
import LandingLayout from './landing_layout';
import { Announcement } from '@/components/collection/_unsorted_legacy/announcement';
import { Play, Heart, AlertTriangle, Users, FileText, GitCommitHorizontal, Waypoints } from 'lucide-react';
import announcements from './announcements.json';

import useAuth from '@/hooks/useAuth';

const announcementsEnabled = /^(true|1|yes)$/i.test(
  (process.env.NEXT_PUBLIC_ANNOUNCEMENTS_ENABLED || '').trim()
);



const sleep = (time: number) => new Promise((resolve) => setTimeout(resolve, time));

interface TypeAsyncProps {
  words: string[];
  className?: string;
}

const TypeAsync: React.FC<TypeAsyncProps> = ({ words = [], className = '' }) => {
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const type = async (word: string) => {
      for (let i = 0; i <= word.length; i++) {
        if (isCancelled) return;
        setText(word.slice(0, i));
        await sleep(120);
      }
    };

    const del = async (word: string) => {
      for (let i = word.length; i >= 0; i--) {
        if (isCancelled) return;
        setText(word.slice(0, i));
        await sleep(50);
      }
    };

    const runTypeAsync = async () => {
      for (let i = 0; i < words.length; i++) {
        if (isCancelled) return;
        const word = words[i];
        setTyping(true);
        await type(word);
        if (isCancelled) return;
        await sleep(2000);
        setTyping(false);
        if (i < words.length - 1) {
          await del(word);
          if (isCancelled) return;
          await sleep(500);
        }
      }
    };

    if (words.length > 0) {
      runTypeAsync();
    }

    return () => {
      isCancelled = true;
    };
  }, [words]);

  return <span className={className} style={{ letterSpacing: '0.1em' }} dangerouslySetInnerHTML={{ __html: text }} />;
};

interface HiProps {
  user?: {
    full_name: string;
    email: string;
    avatar?: string;
    is_superuser?: boolean;
  };
}

const HomePage: React.FC<HiProps> = () => {
  const { user, isLoggedIn } = useAuth();
  const words = ['looking', 'researching', 'rooting', 'developing', 'asking', 'proving it', '']; 
  const router = useRouter();

  // Icon mapping
  const iconMap: Record<string, React.ReactNode> = {
    Play: <Play className="ml-1 h-4 w-4" />,
    Heart: <Heart className="ml-1 h-4 w-4" />,
    AlertTriangle: <AlertTriangle className="ml-1 h-4 w-4" />,
    Users: <Users className="ml-1 h-4 w-4" />,
    FileText: <FileText className="ml-1 h-4 w-4" />,
    Waypoints: <Waypoints className="ml-1 h-4 w-4" />,
    CCC: <span className="ml-1 text-lg font-bold">C</span>,
  };

  // Separate announcements by position (only when enabled; landing page only)
  const topAnnouncements = announcementsEnabled ? announcements.filter(a => a.position === 'top') : [];
  const regularAnnouncements = announcementsEnabled ? announcements.filter(a => a.position !== 'top') : [];
  return (
    <LandingLayout>
      <div className="flex flex-col mt-16 md:min-h-screen justify-between">
        {/* Top Announcements */}
        {topAnnouncements.length > 0 && (
          <section className="p-4 bg-transparent max-w-screen-md mx-auto w-full">
            <div className="grid grid-cols-1 gap-4">
              {topAnnouncements.map((announcement) => (
                <div 
                  key={announcement.id}
                  className="rounded-lg shadow-sm bg-secondary/60 hover:bg-secondary/70 transition-all duration-300 hover:cursor-pointer"
                >
                  <Announcement 
                    title={`${announcement.date}: ${announcement.title}`}
                    main_icon={iconMap[announcement.icon]}
                    text={announcement.text}
                    href={announcement.href}
                    hide_arrow={true}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Main Content Section */}
        <section className="flex flex-col items-center justify-center flex-grow p-8">
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-6xl font-bold leading-none text-main-styled-text">
              <span className="flex flex-col items-center">
                <span style={{ letterSpacing: '0.1em' }}>What are you</span>
                <span className="flex items-center">
                  <span id="shimmer-ast" className="shimmer mt-2" style={{ letterSpacing: '0.1em' }}>*</span>
                  <TypeAsync words={words} className="text-main-styled-text" />
                </span>
                <span style={{ letterSpacing: '0.1em' }}>for?</span>
              </span>
            </h1>
          </div>

         {/* Main Buttons */}
         {!isLoggedIn ? (
          <div className="mt-2 text-center">
            <p className="text-blue-500 font-bold mb-3">Open Source Public Intelligence.</p>
            <div className="space-x-2">
              <Button asChild variant="outline" className="border border-blue-500">
                <Link href="https://github.com/JimVincentW/open-politics">
                  Project on GitHub
                </Link>
              </Button>
              <Button asChild>
                <Link href="/accounts/register">
                Check out HQ
                </Link>
              </Button>
            </div>
          </div>
         ) : (
          <div className="mt-2 text-center">
            {user?.full_name && (
              <h3 className="text-main-styled-text font-bold mb-4 text-2xl">
                Welcome back, {user?.full_name}!
              </h3>
            )}
            <div className="inline-flex items-center justify-center">
              <RippleButton
                onClick={() => router.push('/hq')}
                duration="600ms"
                rippleColor="#3b82f6"
                className="h-10 font-bold"
              >
                <span className="mr-2">Check out HQ</span>
              </RippleButton>
            </div>
          </div>
         )}
        </section>

        {/* Announcements Section */}
        {regularAnnouncements.length > 0 && (
          <section className="p-8 bg-transparent max-w-screen-md mx-auto">
            <span className="text-xl font-bold mb-4 block">Updates</span>
            <div className="grid grid-cols-1 gap-4">
              {regularAnnouncements.map((announcement) => (
                <div 
                  key={announcement.id}
                  className="rounded-lg shadow-md bg-secondary/80 hover:bg-secondary/60 transition-all duration-300 hover:cursor-pointer hover:shadow-md"
                >
                  <Announcement 
                    title={`${announcement.date}: ${announcement.title}`}
                    main_icon={iconMap[announcement.icon]}
                    text={announcement.text}
                    href={announcement.href}
                    hide_arrow={true}
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <style jsx>{`
        .shimmer {
          display: inline-block;
          animation: shimmer 2s infinite linear;
        }

        @keyframes shimmer {
          0% { color: red; }
          20% { color: orange; }
          40% { color: yellow; }
          60% { color: green; }
          80% { color: blue; }
          100% { color: violet; }
        }
      `}</style>
    </LandingLayout>
  );
};

export default HomePage;  