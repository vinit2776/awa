export default function OfflinePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-lg font-medium">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This page needs a connection to load — nothing here is cached for offline use, since this app shows
        different data to every signed-in user. Reconnect and try again.
      </p>
    </div>
  );
}
