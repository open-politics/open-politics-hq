'use client'

import Footer from "@/components/collection/_unsorted_legacy/Footer"
import Header from "@/components/collection/_unsorted_legacy/Header"

export default function MdxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col relative z-20 pt-16">
      <Header />
      <div className="
        flex-1
        container mx-auto
        px-4 sm:px-6 lg:px-8
        max-w-3xl
        py-8 sm:py-12 lg:py-16
        prose prose-lg
        prose-slate dark:prose-invert
        prose-headings:font-bold prose-headings:tracking-tight
        prose-h1:text-4xl prose-h1:mb-6
        prose-h2:text-3xl prose-h2:mt-12 prose-h2:mb-4
        prose-h3:text-2xl prose-h3:mt-8 prose-h3:mb-3
        prose-p:my-6
        prose-ul:my-6 prose-ul:pl-6
        prose-ol:my-6 prose-ol:pl-6
        prose-li:my-2
        prose-blockquote:my-6 prose-blockquote:pl-4 prose-blockquote:border-l-4
        prose-hr:my-12
        prose-figure:my-8
        prose-figcaption:text-center prose-figcaption:mt-2
        prose-code:text-primary
        prose-a:text-primary hover:prose-a:text-primary/80
        prose-img:rounded-lg prose-img:shadow-md
        relative z-20
      ">
        {children}
      </div>
      <Footer />
    </div>
  )
}