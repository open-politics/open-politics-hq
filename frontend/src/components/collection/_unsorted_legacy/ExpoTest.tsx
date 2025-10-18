import * as React from "react";
import Image from 'next/image';
import { Newspaper, Eye, Search } from 'lucide-react';

export const ExpoTest: React.FC = () => {
  return (
    <div className="flex flex-col text-white rounded-lg border border-solid bg-slate-950 border-slate-400 max-w-[342px]">
      <div className="flex gap-3 px-4 py-2 text-base font-bold rounded-lg border border-solid bg-slate-950 border-slate-400">
        <div className="my-auto">News Home</div>
        <Image
          loading="lazy"
          src="https://source.unsplash.com/random/800x600"
          className="flex-1 shrink-0 w-full aspect-[4]"
          alt="Random"
          width={800}
          height={600}
        />
      </div>
      <div className="flex flex-col p-2 mt-4 w-full text-xs rounded-lg backdrop-blur-[10px]">
        <div className="flex flex-col px-2 pt-2 bg-slate-950">
          <div>
            26.06.24/22:30 | 5 Articles |{" "}
            <span className="font-bold"><Newspaper /> <Eye /> </span>🌌 🌋
          </div>
          <div className="mt-2 text-2xl font-bold">Lord of the Rings</div>
          <div className="mt-2">
            Summary Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed
            diam nonumy eirmod tempor invidunt ut labore et dolore magna
            aliquyam erat, sed diam voluptua. At vero eos et accusam et justo
            duo dolores et ea rebum.{" "}
          </div>
          <div className="flex flex-col justify-center mt-3 text-sm leading-5 rounded-lg border border-solid shadow-sm border-slate-400 text-zinc-50">
            <div className="flex flex-col justify-center px-2 w-full rounded-lg bg-slate-950">
              <div className="flex gap-2 px-2 py-2.5 bg-slate-950">
                <Search className="shrink-0 my-auto w-4 aspect-square" />
                <div className="flex-1">Dig deeper...</div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col p-4 mt-4 w-full rounded-3xl border border-solid bg-slate-950 border-slate-400">
          <div className="flex gap-3 justify-center text-base font-bold">
            <div className="flex-1">
              Gondor Is Under Attack: Gandalf has lost his key in Moria and
              won’t make it in time
            </div>
            <Image
              loading="lazy"
              src="https://source.unsplash.com/random/800x600"
              className="shrink-0 self-start max-w-full aspect-[1.41] w-[161px]"
              alt="Gandalf"
              width={161}
              height={114}
            />
          </div>
          <div className="mt-3 leading-4">
            Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam
            nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam
            erat, sed diam voluptua. At vero eos et accusam et justo duo dolores
            et ea rebum.{" "}
          </div>
          <div className="flex gap-1 pr-20 mt-3 whitespace-nowrap">
            <div className="justify-center px-3 py-1 rounded-md bg-neutral-600 bg-opacity-80">
              so
            </div>
            <div className="justify-center px-3 py-1 rounded-md bg-neutral-600 bg-opacity-80">
              ein
            </div>
            <div className="justify-center px-3 py-1 rounded-md bg-neutral-600 bg-opacity-80">
              feuerball
            </div>
          </div>
        </div>
        <div className="flex flex-col p-4 mt-4 w-full rounded-3xl border border-solid bg-slate-950 border-slate-400">
          <div className="text-base font-bold">Article 1 </div>
          <div className="mt-2 leading-4">
            Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam
            nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam
            erat, sed diam voluptua. At vero eos et accusam et justo duo dolores
            et ea rebum.{" "}
          </div>
          <div className="flex gap-1 pr-20 mt-3 whitespace-nowrap">
            <div className="justify-center px-3 py-1 rounded-md bg-neutral-600 bg-opacity-80">
              so
            </div>
            <div className="justify-center px-3 py-1 rounded-md bg-neutral-600 bg-opacity-80">
              ein
            </div>
            <div className="justify-center px-3 py-1 rounded-md bg-neutral-600 bg-opacity-80">
              feuerball
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}