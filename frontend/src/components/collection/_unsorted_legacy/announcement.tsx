import Link from "next/link"
import { ArrowRight } from "lucide-react"

interface Event {
  name: string;
  location: string;
  dateTime: string;
}

interface Link {
  href: string;
  title: string;
  event_icon?: React.ReactNode;
}

export function Announcement({ title, text, href, main_icon, events, links, hide_arrow = false, orientation = "left" }: { title: string; text: string; href: string; main_icon?: React.ReactNode; events?: Event[]; links?: Link[]; hide_arrow?: boolean; orientation?: "left" | "right" }) {
  return (
    <div className={`flex flex-col p-4 rounded-md ${orientation === "right" ? "text-right" : "text-left"}`}>
      <Link
        href={href}
        className="group mb-2 inline-flex items-center px-0.5 text-sm font-medium"
      >
        <div className="flex flex-col">
          <div className="flex flex-row items-center gap-2">
            {main_icon && <span className="text-sm text-gray-500">{main_icon}</span>}
            <span className="underline-offset-4">{title}</span>
          </div>
          <span className="mt-2 ml-7 text-sm text-gray-500 mt-1">{text}</span>
        </div>
      </Link>
      {links && links.length > 0 && (
        <ul className="ml-6 text-sm text-gray-500 mt-2">
          {links.map((link, index) => (
            <li key={index}>
              <div className="flex flex-row items-center gap-2 hover:underline"> 
                {link.event_icon && <span className="">{link.event_icon}</span>}
                <Link href={link.href} className="text-gray-500 hover:text-gray-200">{link.title}</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {events && events.length > 0 && (
        <ul className="ml-7 text-sm text-gray-500 mt-2">
          {events.map((event, index) => (
            <li key={index}>
              <div className="flex flex-col md:flex-row md:items-center gap-2">
                <span className="text-gray-500">{event.name}</span>
                <span className="text-gray-500">{event.location}</span>
                <span className="text-gray-500">{event.dateTime}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!hide_arrow && <ArrowRight className="ml-1 h-4 w-4 mt-2" />}
    </div>
  )
}
