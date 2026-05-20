import Link from 'next/link';
import Image from 'next/image';

const Footer = () => {
  return (
    <footer className="w-full pt-24 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-12">
          <div className="md:col-span-2">
            <div className="flex space-x-4 items-center">
              <a href="https://www.fu-berlin.de/"><Image src="/logos/fu-logo.svg" alt="FU Berlin Logo" width={100} height={24} className="dark:brightness-0 dark:invert" /></a>
              <a href="https://heimatderfreiheit.de/" className="p-2"><Image src="/logos/prometheus-logo-transparent.png" alt="Prometheus Logo" width={56} height={56} className="dark:brightness-0 dark:invert" /></a>
              <a href="https://www.ngisearch.eu/view/Main/"><Image src="/logos/ngi-logo.svg" alt="NGI Logo" width={60} height={60} /></a>
              <a href="https://europa.eu/"><Image src="/logos/eu-logo.png" alt="EU Logo" width={60} height={75} /></a>
              <a href="https://www.wauland.de/"><Image src="/logos/whs-logo.svg" alt="WHS Logo" width={70} height={52} className="dark:brightness-0 dark:invert" /></a>
              <a href="https://www.trustberg.com/"><Image src="/logos/trustberg-logo-bigger.png" alt="Trustberg Logo" width={28} height={28} quality={100} className="dark:brightness-0 dark:invert" /></a>
            </div>

            <div className="pt-6 text-[15px] text-foreground/85 leading-relaxed">
              <p>The EU. A think tank. Hackers. A law firm. A university.</p>
              <p>They don&apos;t agree on much.</p>
              <p>They agreed on us.</p>
            </div>

            <p className="pt-5 text-sm font-semibold text-foreground" style={{ letterSpacing: '0.1em' }}>
              Open Source Public Intelligence.
            </p>

            {/* <div className="pt-6 text-xs text-muted-foreground/60 leading-relaxed">
              <p>In cooperation with WHS, FU Berlin and Trustberg.</p>
              <p>Supported by NGI Search, the European Union and Prometheus.</p>
            </div> */}
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li><Link href="/webpages/about" className="text-sm hover:underline">About Us</Link></li>
              <li><Link href="https://docs.open-politics.org/pages/app/overview/" className="text-sm hover:underline">User Guide</Link></li>
              <li><Link href="https://docs.open-politics.org/pages/app/overview/development" className="text-sm hover:underline">Documentation</Link></li>
              <li><Link href="https://github.com/JimVincentW/open-politics" className="text-sm hover:underline">GitHub</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-4">Contact</h3>
            <a href="mailto:engage@open-politics.org" className="text-sm hover:underline">engage@open-politics.org</a>
            <div className="mt-4">
              <Link href="https://forum.open-politics.org" className="text-sm hover:underline">Forum</Link>
            </div>
            <div className="mt-4">
              <Link href="/webpages/imprint" className="text-sm hover:underline">Imprint</Link>
            </div>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-border text-center text-sm">
          <p>&copy; {new Date().getFullYear()} Open Politics. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
