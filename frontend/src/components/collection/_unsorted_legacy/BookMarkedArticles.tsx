import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BookOpen, X } from 'lucide-react'; // Import X icon
import { useBookMarkStore } from '@/zustand_stores/storeBookmark';

export function BookmarkedArticles() {
  const { getBookmarks, removeBookmark } = useBookMarkStore();
  const bookmarks = getBookmarks();
  const [isOpen, setIsOpen] = useState(false);
  const [fileName, setFileName] = useState('bookmarks');

  const escapeForCSV = (text: string) => {
    if (!text) return '';
    return `"${text.replace(/"/g, '""')}"`;
  };

  const downloadCSV = () => {
    const csvContent = [
      ['ID', 'Headline', 'Paragraphs', 'URL', 'Source', 'Insertion Date', 'Entities', 'Tags', 'Classification'],
      ...bookmarks.map(bookmark => [
        escapeForCSV(bookmark.id),
        escapeForCSV(bookmark.headline),
        escapeForCSV(bookmark.paragraphs),
        escapeForCSV(bookmark.url),
        escapeForCSV(bookmark.source),
        escapeForCSV(bookmark.insertion_date),
        escapeForCSV(JSON.stringify(bookmark.entities)),
        escapeForCSV(JSON.stringify(bookmark.tags)),
        escapeForCSV(JSON.stringify(bookmark.classification))
      ])
    ].map(e => e.join(",")).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${fileName}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button className="flex items-center space-x-2">
            <BookOpen className="text-blue-500" />
            <span>{bookmarks.length}</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] max-w-[90vw] md:max-w-[50vw] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bookmarked Articles</DialogTitle>
          </DialogHeader>
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="Enter file name"
            className="mb-4 p-2 border rounded"
          />
          <Button onClick={downloadCSV} className="mb-4">Download as CSV</Button>
          {bookmarks.length === 0 ? (
            <p>No bookmarks yet.</p>
          ) : (
            bookmarks.map((bookmark) => (
              <div key={bookmark.url} className="relative mb-4 p-4 border rounded-lg">
                <div className="absolute top-2 right-2" onClick={() => removeBookmark(bookmark.url)}>
                  <X className="text-red-500 cursor-pointer" />
                </div>
                <a href={bookmark.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  {bookmark.headline}
                </a>
                <p>{bookmark.source}</p>
                <p>{bookmark.paragraphs ? bookmark.paragraphs.slice(0, 350) : ''}...</p>
              </div>
            ))
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default BookmarkedArticles;