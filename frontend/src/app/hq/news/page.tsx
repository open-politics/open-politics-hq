export default function NewsPage() {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Globe View</h1>
        <div className="rounded-lg border p-4">
          <p>This is where the globe visualization will go.</p>
          <div className="mt-4 grid gap-2">
            <div className="h-40 rounded bg-muted flex items-center justify-center">
              Globe Placeholder
            </div>
          </div>
        </div>
      </div>
    )
  }