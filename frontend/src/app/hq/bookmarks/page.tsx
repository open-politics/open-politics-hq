export default function BookmarksPage() {
    const bookmarks = [
      { id: 1, title: 'Example Bookmark 1', url: '#' },
      { id: 2, title: 'Example Bookmark 2', url: '#' },
      { id: 3, title: 'Example Bookmark 3', url: '#' },
    ]
  
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Bookmarks</h1>
        <div className="grid gap-4">
          {bookmarks.map((bookmark) => (
            <div key={bookmark.id} className="rounded-lg border p-4">
              <h2 className="font-semibold">{bookmark.title}</h2>
              <a href={bookmark.url} className="text-sm text-muted-foreground">
                {bookmark.url}
              </a>
            </div>
          ))}
        </div>
      </div>
    )
  }