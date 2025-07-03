'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import LandingLayout from './landing_layout';
import { Announcement } from '@/components/collection/unsorted/announcement';
import { Play, NewspaperIcon, Globe2, ZoomIn } from 'lucide-react';
import TextWriter from "@/components/ui/extra-animated-base-components/text-writer";

import useAuth from '@/hooks/useAuth';



const sleep = (time: number) => new Promise((resolve) => setTimeout(resolve, time));

interface TypeAsyncProps {
  words: string[];
}

const TypeAsync: React.FC<TypeAsyncProps> = ({ words = [] }) => {
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(true);

  useEffect(() => {
    const type = async (word: string) => {
      for (let i = 0; i <= word.length; i++) {
        setText(word.slice(0, i));
        await sleep(100); // Set your typing interval here
      }
    };

    const del = async (word: string) => {
      for (let i = word.length; i >= 0; i--) {
        setText(word.slice(0, i));
        await sleep(50); // Set your deleting interval here
      }
    };

    const runTypeAsync = async () => {
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        setTyping(true);
        await type(word);
        await sleep(2000); // Pause after typing the word
        setTyping(false);
        if (i < words.length - 1) {
          await del(word);
          await sleep(500); // Pause after deleting the word
        }
      }
    };

    if (words.length > 0) {
      runTypeAsync();
    }
  }, [words]);

  return <span style={{ letterSpacing: '0.1em' }} dangerouslySetInnerHTML={{ __html: text }} />;
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
  const words = ['looking', 'researching', 'rooting', 'developing', 'asking', '']; 

  return (
    <LandingLayout>
      <div className="flex flex-col mt-36 md:mt-0 md:min-h-screen justify-between">
        {/* Main Content Section */}
        <section className="flex flex-col items-center justify-center flex-grow p-8">
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-6xl font-bold leading-none dark:text-white">
              <span className="flex flex-col items-center">
                <span style={{ letterSpacing: '0.1em' }}>What are you</span>
                <span className="flex items-center">
                  <span id="shimmer-ast" className="shimmer mt-2" style={{ letterSpacing: '0.1em' }}>*</span>
                  <TypeAsync words={words} />
                </span>
                <span style={{ letterSpacing: '0.1em' }}>for?</span>
              </span>
            </h1>
          </div>

         {/* Main Buttons */}
         {!isLoggedIn ? (
          <div className="mt-2 text-center">
            <p className="text-blue-500 font-bold mb-3">Open Source Political Intelligence.</p>
            <div className="space-x-2">
              <Button asChild variant="outline" className="border border-blue-500">
                <Link href="https://github.com/JimVincentW/open-politics">
                  Project on GitHub
                </Link>
              </Button>
              <Button asChild>
                <Link href="https://zu61ygkfc3v.typeform.com/to/KHZeedk3">
                  Join the waitlist
                </Link>
              </Button>
            </div>
          </div>
         ) : (
          <div className="mt-2 text-center">
            <p className="text-blue-500 font-bold mb-3">Welcome back{user?.full_name ? `, ${user?.full_name}` : ''  }!</p>
            <Button 
              variant="ghost" 
              asChild 
              className="group relative overflow-hidden ring-1 ring-blue-500 ring-offset-0 px-6 rounded-lg transition-all duration-300"
            >
              <Link href="/desks/home">
                <TextWriter
                  text={<div className="flex items-center gap-1 relative z-10">
                    <NewspaperIcon className="w-4 h-4" />
                    <Globe2 className="w-4 h-4" />
                    <ZoomIn className="w-4 h-4" />
                    <span>Desk</span>
                  </div>}
                  typingDelay={100}
                  startDelay={500}
                  className="animate-shimmer-once"
                  cursorColor="transparent"
                />
              </Link>
            </Button>
          </div>
         )}
        </section>

        {/* Announcements Section */}
        {/* <section className="p-8 bg-transparent max-w-screen-md mx-auto">
            <span className="text-xl font-bold mb-4 block">What's new?</span>
            <div className="grid grid-cols-1 gap-4">
              <div className=" rounded-lg shadow-md bg-secondary/80 hover:bg-secondary/60 transition-all duration-300 hover:cursor-pointer hover:shadow-md">
                <Announcement 
                  title="01.02.2025: We are (slowly) coming online !" 
                  main_icon={<Play className="ml-1 h-4 w-4" />}
                  text="Preparations in full swing. Our public beta geospatial (Globe UI) and search modules are launching soon. Stay tuned."
                  href="https://github.com/open-politics/opol"
                  hide_arrow={true}
                  // links={[
                  //   { href: 'https://github.com/open-politics/open-politics', title: 'Read more', event_icon: <FileText className="ml-1 h-4 w-4" /> },
                  // ]}
                />
              </div>
              {/* <div className=" rounded-lg shadow-md bg-secondary/80 hover:bg-secondary/60 transition-all duration-300 hover:cursor-pointer hover:shadow-md">
                <Announcement 
                  title="05.02.2025: Open Politics @ Chaos Computer Club Berlin" 
                  text="We are inviting you to a talk on Open Politics at the Chaos Computer Club Berlin on February 05th, 2025."
                  href="https://berlin.ccc.de/datengarten/111/"
                  main_icon={<FaMicrophone className="ml-1 h-4 w-4" />}
                  hide_arrow={true}
                  orientation="left"
                  events={[
                    { name: 'Open Politics @ Chaos Computer Club Berlin, Datengarten #111', location: 'Marienstraße 11, Berlin', dateTime: 'February 05th, 2025' },
                  ]}
                />
              </div> */}
            {/* </div> */}
        {/* </section> */}
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

        .group:hover .absolute {
          animation: rainbow-shimmer 2s linear infinite;
          background-size: 200% 200%;
        }
        
        @keyframes rainbow-shimmer {
          0% { background-position: 0% 50%; background-image: linear-gradient(to right, rgba(239, 68, 68, 0.3), rgba(249, 115, 22, 0.3), rgba(234, 179, 8, 0.3)); }
          25% { background-position: 50% 50%; background-image: linear-gradient(to right, rgba(234, 179, 8, 0.3), rgba(34, 197, 94, 0.3), rgba(59, 130, 246, 0.3)); }
          50% { background-position: 100% 50%; background-image: linear-gradient(to right, rgba(59, 130, 246, 0.3), rgba(139, 92, 246, 0.3), rgba(239, 68, 68, 0.3)); }
          75% { background-position: 50% 50%; background-image: linear-gradient(to right, rgba(139, 92, 246, 0.3), rgba(239, 68, 68, 0.3), rgba(249, 115, 22, 0.3)); }
          100% { background-position: 0% 50%; background-image: linear-gradient(to right, rgba(239, 68, 68, 0.3), rgba(249, 115, 22, 0.3), rgba(234, 179, 8, 0.3)); }
        }
      `}</style>
    </LandingLayout>
  );
};

export default HomePage;